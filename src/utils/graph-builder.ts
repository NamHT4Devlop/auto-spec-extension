/**
 * graph-builder.ts
 * Parses KB markdown files + src/ TypeScript imports to produce
 * a nodes/edges JSON structure for D3.js force-directed graph.
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Types ────────────────────────────────────────────────────────────────────

export type NodeType =
  | 'command' | 'workflow' | 'util' | 'storage'
  | 'domain' | 'file' | 'config' | 'resource';

export type NodeLayer =
  | 'commands' | 'workflow' | 'utils' | 'storage' | 'domain' | 'external';

export interface GraphNode {
  id: string;
  label: string;
  type: NodeType;
  layer: NodeLayer;
  description: string;
  file?: string;
  details?: string;   // raw KB content snippet
  size?: number;      // relative importance (1-5)
}

export interface GraphEdge {
  source: string;
  target: string;
  type: 'imports' | 'calls' | 'depends' | 'flows-to' | 'defines';
  label?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  layers: { id: NodeLayer; label: string; color: string }[];
  metadata: {
    projectName: string;
    generatedAt: string;
    nodeCount: number;
    edgeCount: number;
  };
}

// ── Layer colour palette (matches Understand-Anything style) ────────────────

export const LAYER_CONFIG: Record<NodeLayer, { label: string; color: string }> = {
  commands:  { label: 'Commands',      color: '#4f8ef7' },
  workflow:  { label: 'Workflow',      color: '#34c78a' },
  utils:     { label: 'Utils',         color: '#f7a34f' },
  storage:   { label: 'Storage / IO',  color: '#9b59b6' },
  domain:    { label: 'Domain / KB',   color: '#e74c3c' },
  external:  { label: 'External',      color: '#95a5a6' },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function readFileSafe(filePath: string): string {
  try { return fs.readFileSync(filePath, 'utf8'); }
  catch { return ''; }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function extractHeadings(md: string): string[] {
  return md.split('\n')
    .filter(l => /^#{1,3}\s/.test(l))
    .map(l => l.replace(/^#+\s+/, '').trim());
}

function firstParagraph(md: string): string {
  const lines = md.split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (t && !t.startsWith('#') && !t.startsWith('|') && !t.startsWith('-') && !t.startsWith('`')) {
      return t.slice(0, 200);
    }
  }
  return '';
}

// ── Parse TypeScript source files for import relationships ───────────────────

function parseTsImports(srcDir: string): Map<string, string[]> {
  const deps = new Map<string, string[]>();
  if (!fs.existsSync(srcDir)) { return deps; }

  const walk = (dir: string): string[] => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { files.push(...walk(full)); }
      else if (e.name.endsWith('.ts')) { files.push(full); }
    }
    return files;
  };

  for (const file of walk(srcDir)) {
    const rel = path.relative(srcDir, file).replace(/\\/g, '/').replace(/\.ts$/, '');
    const content = readFileSafe(file);
    const imports: string[] = [];
    const re = /from\s+['"](\.\.?\/[^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      // resolve relative to file's directory
      const resolved = path.relative(
        srcDir,
        path.resolve(path.dirname(file), m[1])
      ).replace(/\\/g, '/');
      imports.push(resolved);
    }
    deps.set(rel, imports);
  }
  return deps;
}

// ── Map file path → layer ────────────────────────────────────────────────────

function inferLayer(relPath: string): NodeLayer {
  if (relPath.includes('workflow/')) { return 'workflow'; }
  if (relPath.includes('utils/'))    { return 'utils'; }
  if (relPath.includes('constants/') || relPath.includes('types/')) { return 'domain'; }
  if (relPath === 'extension' || relPath === 'logger') { return 'commands'; }
  return 'utils';
}

function inferType(relPath: string, layer: NodeLayer): NodeType {
  if (layer === 'commands') { return 'command'; }
  if (layer === 'workflow') { return 'workflow'; }
  if (relPath.includes('storage') || relPath.includes('checkpoint')) { return 'storage'; }
  if (layer === 'domain')  { return 'domain'; }
  return 'util';
}

// ── Build source-file graph ──────────────────────────────────────────────────

function buildFileGraph(srcDir: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const deps = parseTsImports(srcDir);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const [relPath] of deps) {
    const layer = inferLayer(relPath);
    const label = path.basename(relPath).replace(/\.[jt]s$/, '');
    nodes.push({
      id: `file:${relPath}`,
      label,
      type: inferType(relPath, layer),
      layer,
      description: `${relPath}.ts`,
      file: relPath + '.ts',
      size: relPath === 'extension' ? 5 : relPath.startsWith('workflow/') ? 4 : 3,
    });
  }

  for (const [relPath, imports] of deps) {
    for (const imp of imports) {
      if (deps.has(imp)) {
        edges.push({
          source: `file:${relPath}`,
          target: `file:${imp}`,
          type: 'imports',
        });
      }
    }
  }

  return { nodes, edges };
}

// ── Parse KB markdown for domain/architecture graph ──────────────────────────

function buildKBGraph(kbDir: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  if (!fs.existsSync(kbDir)) { return { nodes, edges }; }

  const KB_FILES: { file: string; layer: NodeLayer; type: NodeType }[] = [
    { file: '04-business-overview.md', layer: 'domain',   type: 'domain' },
    { file: '05-domain-model.md',      layer: 'domain',   type: 'domain' },
    { file: '06-modules.md',           layer: 'workflow',  type: 'workflow' },
    { file: '03-entry-points.md',      layer: 'commands',  type: 'command' },
    { file: '09-auth-flow.md',         layer: 'workflow',  type: 'workflow' },
    { file: '10-core-flow.md',         layer: 'workflow',  type: 'workflow' },
    { file: '12-conventions.md',       layer: 'utils',    type: 'util' },
  ];

  for (const { file, layer, type } of KB_FILES) {
    const fullPath = path.join(kbDir, file);
    const content = readFileSafe(fullPath);
    if (!content) { continue; }

    const headings = extractHeadings(content);
    const parentId = `kb:${slug(file)}`;

    // Parent node = the KB file itself
    nodes.push({
      id: parentId,
      label: file.replace(/^\d+-/, '').replace('.md', '').replace(/-/g, ' '),
      type,
      layer,
      description: firstParagraph(content) || file,
      file: `knowledge-base/${file}`,
      details: content.slice(0, 600),
      size: 4,
    });

    // Child nodes = section headings (skip H1)
    const childIds: string[] = [];
    for (const h of headings.slice(1, 8)) {
      if (!h || h.length < 3) { continue; }
      const childId = `kb:${slug(file)}-${slug(h)}`;
      nodes.push({
        id: childId,
        label: h.slice(0, 40),
        type,
        layer,
        description: h,
        file: `knowledge-base/${file}`,
        size: 2,
      });
      edges.push({ source: parentId, target: childId, type: 'defines' });
      childIds.push(childId);
    }

    // Link consecutive sections as flow
    for (let i = 0; i < childIds.length - 1; i++) {
      edges.push({ source: childIds[i], target: childIds[i + 1], type: 'flows-to' });
    }
  }

  return { nodes, edges };
}

// ── Architecture layer graph (high-level) ────────────────────────────────────

function buildArchGraph(): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [
    { id: 'arch:vscode',      label: 'VS Code API',         type: 'command',  layer: 'commands', description: 'vscode.commands, vscode.window, vscode.lm', size: 4 },
    { id: 'arch:copilot',     label: 'GitHub Copilot LM',   type: 'command',  layer: 'commands', description: 'vscode.lm — language model access', size: 4 },
    { id: 'arch:extension',   label: 'extension.ts',        type: 'command',  layer: 'commands', description: 'activate() — registers all 7 commands', size: 5 },
    { id: 'arch:run-task',    label: 'Run Task',            type: 'workflow', layer: 'workflow', description: '13-step workflow: Spec → Plan → Code → Review → Test', size: 4 },
    { id: 'arch:generate-kb', label: 'Generate KB',         type: 'workflow', layer: 'workflow', description: '15-step KB pipeline to analyze codebase', size: 4 },
    { id: 'arch:review-file', label: 'Review File',         type: 'workflow', layer: 'workflow', description: 'Two-phase code review with git diff context', size: 4 },
    { id: 'arch:user-stories',label: 'User Stories',        type: 'workflow', layer: 'workflow', description: 'PO/BA 4-step pipeline → JSON + HTML sprint board', size: 4 },
    { id: 'arch:update-kb',   label: 'Update KB',           type: 'workflow', layer: 'workflow', description: 'Incremental KB update after task completion', size: 3 },
    { id: 'arch:ask-kb',      label: 'Ask Codebase',        type: 'workflow', layer: 'workflow', description: 'Q&A over knowledge base with Copilot', size: 3 },
    { id: 'arch:visualize',   label: 'Visualize KB',        type: 'workflow', layer: 'workflow', description: 'Knowledge graph — nodes, edges, D3 force graph', size: 4 },
    { id: 'arch:copilot-util',label: 'copilot.ts',          type: 'util',     layer: 'utils',    description: 'callCopilot() — core LM invocation utility', size: 4 },
    { id: 'arch:model-sel',   label: 'model-selector.ts',   type: 'util',     layer: 'utils',    description: 'resolveModel(), runSelectModel() — smart model picker', size: 3 },
    { id: 'arch:git-utils',   label: 'git-utils.ts',        type: 'util',     layer: 'utils',    description: 'loadGitDiff() — git diff for review context', size: 3 },
    { id: 'arch:html-builder',label: 'html-builder.ts',     type: 'util',     layer: 'utils',    description: 'buildUserStoriesHtml(), buildKnowledgeGraphHtml()', size: 3 },
    { id: 'arch:graph-builder',label: 'graph-builder.ts',   type: 'util',     layer: 'utils',    description: 'buildGraphData() — parses KB + src → nodes/edges JSON', size: 3 },
    { id: 'arch:file-utils',  label: 'file-utils.ts',       type: 'util',     layer: 'utils',    description: 'readKB(), writeSession(), saveHtmlReport()', size: 3 },
    { id: 'arch:checkpoint',  label: 'checkpoint.ts',       type: 'storage',  layer: 'storage',  description: 'saveCheckpoint(), loadCheckpoint() — resume support', size: 3 },
    { id: 'arch:kb-steps',    label: 'kb-steps.ts',         type: 'domain',   layer: 'domain',   description: 'KB_STEPS constant — 15 Copilot prompts for KB generation', size: 3 },
    { id: 'arch:kb-files',    label: 'knowledge-base/',     type: 'storage',  layer: 'storage',  description: '15 markdown files: project structure, domain model, flows…', size: 4 },
    { id: 'arch:sessions',    label: 'spec-kit-sessions/',  type: 'storage',  layer: 'storage',  description: 'Session outputs: specs, plans, code, reviews, evidence', size: 3 },
    { id: 'arch:review-skills',label: 'review-skills-universal.md', type: 'resource', layer: 'domain', description: '14-section universal code review checklist', size: 3 },
  ];

  const edges: GraphEdge[] = [
    { source: 'arch:vscode',       target: 'arch:extension',    type: 'depends', label: 'activates' },
    { source: 'arch:copilot',      target: 'arch:copilot-util', type: 'depends', label: 'LM access' },
    { source: 'arch:extension',    target: 'arch:run-task',      type: 'calls' },
    { source: 'arch:extension',    target: 'arch:generate-kb',   type: 'calls' },
    { source: 'arch:extension',    target: 'arch:review-file',   type: 'calls' },
    { source: 'arch:extension',    target: 'arch:user-stories',  type: 'calls' },
    { source: 'arch:extension',    target: 'arch:update-kb',     type: 'calls' },
    { source: 'arch:extension',    target: 'arch:ask-kb',        type: 'calls' },
    { source: 'arch:extension',    target: 'arch:visualize',     type: 'calls' },
    { source: 'arch:run-task',     target: 'arch:copilot-util',  type: 'imports' },
    { source: 'arch:generate-kb',  target: 'arch:copilot-util',  type: 'imports' },
    { source: 'arch:generate-kb',  target: 'arch:kb-steps',      type: 'imports' },
    { source: 'arch:generate-kb',  target: 'arch:kb-files',      type: 'depends', label: 'writes' },
    { source: 'arch:review-file',  target: 'arch:copilot-util',  type: 'imports' },
    { source: 'arch:review-file',  target: 'arch:git-utils',     type: 'imports' },
    { source: 'arch:review-file',  target: 'arch:review-skills', type: 'depends', label: 'injects' },
    { source: 'arch:user-stories', target: 'arch:html-builder',  type: 'imports' },
    { source: 'arch:user-stories', target: 'arch:copilot-util',  type: 'imports' },
    { source: 'arch:visualize',    target: 'arch:graph-builder', type: 'imports' },
    { source: 'arch:visualize',    target: 'arch:html-builder',  type: 'imports' },
    { source: 'arch:visualize',    target: 'arch:kb-files',      type: 'depends', label: 'reads' },
    { source: 'arch:run-task',     target: 'arch:checkpoint',    type: 'imports' },
    { source: 'arch:run-task',     target: 'arch:sessions',      type: 'depends', label: 'writes' },
    { source: 'arch:run-task',     target: 'arch:kb-files',      type: 'depends', label: 'reads' },
    { source: 'arch:copilot-util', target: 'arch:model-sel',     type: 'imports' },
    { source: 'arch:generate-kb',  target: 'arch:file-utils',    type: 'imports' },
    { source: 'arch:run-task',     target: 'arch:file-utils',    type: 'imports' },
  ];

  return { nodes, edges };
}

// ── Main builder ─────────────────────────────────────────────────────────────

export function buildGraphData(
  rootDir: string,
  mode: 'architecture' | 'modules' | 'domain' | 'files' | 'all' = 'all'
): GraphData {
  const srcDir = path.join(rootDir, 'src');
  const kbDir  = path.join(rootDir, 'knowledge-base');

  const allNodes: GraphNode[] = [];
  const allEdges: GraphEdge[] = [];
  const seen = new Set<string>();

  const addNodes = (ns: GraphNode[]) => {
    for (const n of ns) {
      if (!seen.has(n.id)) { seen.add(n.id); allNodes.push(n); }
    }
  };

  if (mode === 'architecture' || mode === 'all') {
    const { nodes, edges } = buildArchGraph();
    addNodes(nodes); allEdges.push(...edges);
  }
  if (mode === 'modules' || mode === 'files' || mode === 'all') {
    const { nodes, edges } = buildFileGraph(srcDir);
    addNodes(nodes); allEdges.push(...edges);
  }
  if (mode === 'domain' || mode === 'all') {
    const { nodes, edges } = buildKBGraph(kbDir);
    addNodes(nodes); allEdges.push(...edges);
  }

  // Deduplicate edges
  const edgeSeen = new Set<string>();
  const uniqueEdges = allEdges.filter(e => {
    const key = `${e.source}→${e.target}`;
    if (edgeSeen.has(key)) { return false; }
    edgeSeen.add(key); return true;
  });

  // Resolve dangling edges (remove edges with missing nodes)
  const nodeIds = new Set(allNodes.map(n => n.id));
  const validEdges = uniqueEdges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));

  // Try to get project name from package.json
  let projectName = 'Auto Spec Kit';
  try {
    const pkg = JSON.parse(readFileSafe(path.join(rootDir, 'package.json')));
    projectName = pkg.displayName || pkg.name || projectName;
  } catch { /* ignore */ }

  return {
    nodes: allNodes,
    edges: validEdges,
    layers: Object.entries(LAYER_CONFIG).map(([id, cfg]) => ({
      id: id as NodeLayer,
      label: cfg.label,
      color: cfg.color,
    })),
    metadata: {
      projectName,
      generatedAt: new Date().toISOString(),
      nodeCount: allNodes.length,
      edgeCount: validEdges.length,
    },
  };
}
