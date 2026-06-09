/**
 * graph-builder.ts — Universal Multi-Language Deep Graph Scanner
 *
 * Works for ANY project: TS/JS, Python, Java, Go, Ruby, C#, PHP, Rust.
 *
 * 3 analysis layers:
 *   Layer 1 — Static: file imports, class hierarchy, function declarations
 *   Layer 2 — Deep:   method calls, entity fields, API routes, DI wiring
 *   Layer 3 — AI:     business flow inference, entity relationships, architecture classification
 *                     (optional — requires model + token, runs via AgentOrchestrator)
 *
 * Output: GraphData JSON consumed by html-builder.ts → D3.js force graph
 */

import * as fs from 'fs';
import * as path from 'path';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type NodeType =
  | 'file' | 'class' | 'interface' | 'function' | 'method'
  | 'entity' | 'controller' | 'service' | 'repository'
  | 'middleware' | 'route' | 'config' | 'test'
  | 'kb-topic' | 'kb-section'
  | 'module';

export type NodeLayer =
  | 'presentation' | 'business' | 'data' | 'infrastructure'
  | 'domain' | 'test' | 'config' | 'external';

export type EdgeType =
  | 'imports' | 'calls' | 'extends' | 'implements'
  | 'depends' | 'injects' | 'emits' | 'listens'
  | 'has-field' | 'relates-to' | 'defines'
  | 'flows-to' | 'reads' | 'writes' | 'tests';

export interface GraphNode {
  id: string;
  label: string;
  type: NodeType;
  layer: NodeLayer;
  description: string;
  file?: string;          // relative path to source file
  line?: number;          // line number in source
  language?: string;      // detected language
  details?: string;       // extra info (signature, fields, etc.)
  size?: number;          // 1-5, relative importance
  methods?: string[];     // for class nodes — list of method names
  fields?: string[];      // for entity nodes — list of field names
}

export interface GraphEdge {
  source: string;
  target: string;
  type: EdgeType;
  label?: string;
  weight?: number;        // 1-3, strength of relationship
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
    languages: string[];
    scanDurationMs: number;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

export const LAYER_CONFIG: Record<NodeLayer, { label: string; color: string }> = {
  presentation:    { label: 'Presentation',     color: '#4f8ef7' },
  business:        { label: 'Business Logic',   color: '#34c78a' },
  data:            { label: 'Data Layer',       color: '#9b59b6' },
  infrastructure:  { label: 'Infrastructure',   color: '#f7a34f' },
  domain:          { label: 'Domain / KB',      color: '#e74c3c' },
  test:            { label: 'Tests',            color: '#1abc9c' },
  config:          { label: 'Config',           color: '#95a5a6' },
  external:        { label: 'External',         color: '#7f8c8d' },
};

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '__pycache__',
  '.next', '.nuxt', 'coverage', 'spec-kit-sessions', 'knowledge-base',
  '.vscode', '.idea', 'vendor', 'target', '.gradle', 'bin', 'obj',
  'venv', '.venv', 'env', '.env', 'Pods', '.dart_tool',
]);

const SKIP_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  '.DS_Store', 'Thumbs.db',
]);

// ═══════════════════════════════════════════════════════════════════════════════
// LANGUAGE DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

type LangId = 'typescript' | 'javascript' | 'python' | 'java' | 'go' | 'ruby' | 'csharp' | 'php' | 'rust' | 'unknown';

const EXT_TO_LANG: Record<string, LangId> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python',
  '.java': 'java', '.kt': 'java',
  '.go': 'go',
  '.rb': 'ruby',
  '.cs': 'csharp',
  '.php': 'php',
  '.rs': 'rust',
};

function detectLang(filePath: string): LangId {
  return EXT_TO_LANG[path.extname(filePath).toLowerCase()] ?? 'unknown';
}

// ═══════════════════════════════════════════════════════════════════════════════
// MULTI-LANGUAGE PARSERS
// ═══════════════════════════════════════════════════════════════════════════════

interface ParsedFile {
  relPath: string;
  language: LangId;
  imports: string[];                 // resolved relative import paths
  classes: ParsedClass[];
  functions: ParsedFunction[];
  exports: string[];                 // exported names
  routes: ParsedRoute[];            // API endpoints found
  decorators: string[];             // @Controller, @Injectable, etc.
}

interface ParsedClass {
  name: string;
  line: number;
  extends?: string;
  implements: string[];
  methods: ParsedFunction[];
  fields: { name: string; type?: string }[];
  decorators: string[];
}

interface ParsedFunction {
  name: string;
  line: number;
  isAsync: boolean;
  params: string;
  calls: string[];                   // function/method names called within body
}

interface ParsedRoute {
  method: string;                    // GET, POST, PUT, DELETE, PATCH
  path: string;
  handler: string;
  line: number;
}

// ── Import patterns per language ──────────────────────────────────────────────

const IMPORT_PATTERNS: Record<LangId, RegExp[]> = {
  typescript: [
    /from\s+['"](\.\.?\/[^'"]+)['"]/g,                        // import { x } from './y'
    /require\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g,              // require('./y')
  ],
  javascript: [
    /from\s+['"](\.\.?\/[^'"]+)['"]/g,
    /require\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g,
  ],
  python: [
    /^from\s+([\w.]+)\s+import/gm,                             // from module import x
    /^import\s+([\w.]+)/gm,                                    // import module
  ],
  java: [
    /^import\s+([\w.]+);/gm,                                  // import com.pkg.Class;
  ],
  go: [
    /^\s+"([^"]+)"/gm,                                        // "github.com/pkg/name"
  ],
  ruby: [
    /^require\s+['"]([\w\/]+)['"]/gm,                         // require 'module'
    /^require_relative\s+['"]([\w\/]+)['"]/gm,                // require_relative './file'
  ],
  csharp: [
    /^using\s+([\w.]+);/gm,                                   // using Namespace;
  ],
  php: [
    /^use\s+([\w\\]+)/gm,                                     // use Namespace\Class;
    /require(?:_once)?\s*['"]([\w\/.-]+)['"]/g,               // require 'file.php'
  ],
  rust: [
    /^use\s+([\w:]+)/gm,                                      // use crate::module;
    /^mod\s+(\w+)/gm,                                         // mod module;
  ],
  unknown: [],
};

// ── Class patterns per language ───────────────────────────────────────────────

const CLASS_PATTERN: Record<LangId, RegExp> = {
  typescript:  /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/gm,
  javascript:  /^(?:export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/gm,
  python:      /^class\s+(\w+)(?:\(([\w,\s.]+)\))?:/gm,
  java:        /^(?:public\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/gm,
  go:          /^type\s+(\w+)\s+struct/gm,
  ruby:        /^class\s+(\w+)(?:\s*<\s*(\w+))?/gm,
  csharp:      /^(?:public\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s*:\s*([\w,\s]+))?/gm,
  php:         /^(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/gm,
  rust:        /^(?:pub\s+)?struct\s+(\w+)/gm,
  unknown:     /(?!)/g, // never matches
};

// ── Function patterns per language ────────────────────────────────────────────

const FUNCTION_PATTERN: Record<LangId, RegExp> = {
  typescript:  /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)|(\w+)\s*(?::\s*\w+\s*)?=\s*(?:async\s+)?\([^)]*\)\s*(?::\s*\w+\s*)?=>/gm,
  javascript:  /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)|(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/gm,
  python:      /^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/gm,
  java:        /(?:public|private|protected)\s+(?:static\s+)?(?:\w+\s+)(\w+)\s*\(([^)]*)\)/gm,
  go:          /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(([^)]*)\)/gm,
  ruby:        /^\s*def\s+(\w+[?!]?)/gm,
  csharp:      /(?:public|private|protected)\s+(?:static\s+)?(?:async\s+)?(?:\w+\s+)(\w+)\s*\(([^)]*)\)/gm,
  php:         /(?:public|private|protected)\s+(?:static\s+)?function\s+(\w+)\s*\(([^)]*)\)/gm,
  rust:        /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*\(([^)]*)\)/gm,
  unknown:     /(?!)/g,
};

// ── Route/endpoint patterns ───────────────────────────────────────────────────

const ROUTE_PATTERNS: RegExp[] = [
  // Express/Koa/Fastify: app.get('/path', handler)
  /(?:app|router|server)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
  // Decorators: @Get('/path'), @Post('/path')
  /@(Get|Post|Put|Delete|Patch)\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/gi,
  // Python Flask/FastAPI: @app.route('/path'), @router.get('/path')
  /@(?:app|router)\.(route|get|post|put|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
  // Java Spring: @GetMapping("/path"), @RequestMapping
  /@(GetMapping|PostMapping|PutMapping|DeleteMapping|RequestMapping)\s*\(\s*(?:value\s*=\s*)?['"`]([^'"`]+)['"`]/gi,
  // Go: r.GET("/path", handler)
  /\.(GET|POST|PUT|DELETE|PATCH)\s*\(\s*"([^"]+)"/gi,
  // Ruby Rails: get '/path', to: 'controller#action'
  /^\s*(get|post|put|patch|delete)\s+['"]([^'"]+)['"]/gim,
];

// ── Decorator patterns ────────────────────────────────────────────────────────

const DECORATOR_PATTERN = /@(\w+)\s*(?:\([^)]*\))?/g;

// ═══════════════════════════════════════════════════════════════════════════════
// FILE SCANNER
// ═══════════════════════════════════════════════════════════════════════════════

function walkSourceFiles(rootDir: string, maxDepth = 8): string[] {
  const files: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) { return; }
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.env.example') { continue; }
      if (SKIP_FILES.has(e.name)) { continue; }
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) { walk(full, depth + 1); }
      } else {
        const lang = detectLang(e.name);
        if (lang !== 'unknown') { files.push(full); }
      }
    }
  };
  walk(rootDir, 0);
  return files;
}

function readSafe(p: string): string {
  try { return fs.readFileSync(p, 'utf8'); }
  catch { return ''; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARSE A SINGLE FILE
// ═══════════════════════════════════════════════════════════════════════════════

function parseFile(absPath: string, rootDir: string): ParsedFile {
  const relPath = path.relative(rootDir, absPath).replace(/\\/g, '/');
  const language = detectLang(absPath);
  const content = readSafe(absPath);
  const lines = content.split('\n');

  // ── Imports ──
  const imports: string[] = [];
  const patterns = IMPORT_PATTERNS[language] ?? [];
  for (const pat of patterns) {
    pat.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.exec(content)) !== null) {
      imports.push(m[1]);
    }
  }

  // ── Classes ──
  const classes: ParsedClass[] = [];
  const classRe = CLASS_PATTERN[language];
  if (classRe) {
    classRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = classRe.exec(content)) !== null) {
      const lineNum = content.slice(0, m.index).split('\n').length;
      const className = m[1];
      const extendsName = m[2]?.trim();
      const implStr = m[3] ?? '';
      const impls = implStr ? implStr.split(',').map(s => s.trim()).filter(Boolean) : [];

      // Find methods within class body (simplified — look for method-like patterns after class declaration)
      const classBody = extractBlock(content, m.index);
      const methods = parseFunctionsInBlock(classBody, language, lineNum);

      // Find fields (simplified)
      const fields = parseFields(classBody, language);

      // Find decorators above class
      const decorators = findDecoratorsAbove(lines, lineNum - 1);

      classes.push({
        name: className,
        line: lineNum,
        extends: extendsName || undefined,
        implements: impls,
        methods,
        fields,
        decorators,
      });
    }
  }

  // ── Top-level functions ──
  const functions: ParsedFunction[] = [];
  const funcRe = FUNCTION_PATTERN[language];
  if (funcRe) {
    funcRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = funcRe.exec(content)) !== null) {
      const name = m[1] || m[3];
      if (!name) { continue; }
      const lineNum = content.slice(0, m.index).split('\n').length;
      // Skip if inside a class body (already captured)
      if (classes.some(c => lineNum > c.line && lineNum < c.line + 200)) { continue; }

      const body = extractBlock(content, m.index);
      const calls = extractCalls(body, language);

      functions.push({
        name,
        line: lineNum,
        isAsync: /async/.test(m[0]),
        params: m[2] ?? '',
        calls,
      });
    }
  }

  // ── Exports ──
  const exports: string[] = [];
  const exportRe = /export\s+(?:default\s+)?(?:class|function|const|let|var|interface|type|enum)\s+(\w+)/g;
  let em: RegExpExecArray | null;
  while ((em = exportRe.exec(content)) !== null) {
    exports.push(em[1]);
  }

  // ── Routes ──
  const routes: ParsedRoute[] = [];
  for (const routeRe of ROUTE_PATTERNS) {
    routeRe.lastIndex = 0;
    let rm: RegExpExecArray | null;
    while ((rm = routeRe.exec(content)) !== null) {
      const method = rm[1].toUpperCase().replace('MAPPING', '');
      routes.push({
        method: method === 'ROUTE' ? 'GET' : method,
        path: rm[2],
        handler: relPath,
        line: content.slice(0, rm.index).split('\n').length,
      });
    }
  }

  // ── Decorators (file level) ──
  const decorators: string[] = [];
  DECORATOR_PATTERN.lastIndex = 0;
  let dm: RegExpExecArray | null;
  while ((dm = DECORATOR_PATTERN.exec(content)) !== null) {
    if (!decorators.includes(dm[1])) { decorators.push(dm[1]); }
  }

  return { relPath, language, imports, classes, functions, exports, routes, decorators };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function extractBlock(content: string, startIdx: number): string {
  // Extract ~100 lines after a pattern match (approximate class/function body)
  const rest = content.slice(startIdx);
  const lines = rest.split('\n').slice(0, 100);
  return lines.join('\n');
}

function parseFunctionsInBlock(block: string, lang: LangId, baseLineNum: number): ParsedFunction[] {
  const methods: ParsedFunction[] = [];
  const methodPatterns: Record<string, RegExp> = {
    typescript:  /(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*(?::\s*[\w<>\[\]|]+\s*)?[{]/g,
    javascript:  /(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*[{]/g,
    python:      /def\s+(\w+)\s*\(([^)]*)\)/g,
    java:        /(?:public|private|protected)\s+(?:\w+\s+)(\w+)\s*\(([^)]*)\)/g,
    go:          /func\s+(\w+)\s*\(([^)]*)\)/g,
    ruby:        /def\s+(\w+[?!]?)/g,
    csharp:      /(?:public|private)\s+(?:\w+\s+)(\w+)\s*\(([^)]*)\)/g,
    php:         /function\s+(\w+)\s*\(([^)]*)\)/g,
    rust:        /fn\s+(\w+)\s*\(([^)]*)\)/g,
  };

  const re = methodPatterns[lang];
  if (!re) { return methods; }
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const name = m[1];
    if (['constructor', 'if', 'for', 'while', 'switch', 'catch'].includes(name)) { continue; }
    const bodyChunk = block.slice(m.index, m.index + 500);
    methods.push({
      name,
      line: baseLineNum + block.slice(0, m.index).split('\n').length - 1,
      isAsync: /async/.test(m[0]),
      params: m[2] ?? '',
      calls: extractCalls(bodyChunk, lang),
    });
  }
  return methods;
}

function extractCalls(body: string, _lang: LangId): string[] {
  const calls = new Set<string>();
  // Match: identifier.method( or identifier(
  const re = /(?:(?:this|self|\w+)\.)?(\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const name = m[1];
    if (name.length > 2 && !['function', 'class', 'import', 'require', 'from', 'return',
        'console', 'if', 'for', 'while', 'switch', 'catch', 'new', 'throw', 'typeof',
        'async', 'await', 'super', 'constructor', 'Object', 'Array', 'String', 'Number',
        'parseInt', 'parseFloat', 'setTimeout', 'setInterval', 'Promise', 'Map', 'Set',
        'JSON', 'Math', 'Date', 'Error', 'RegExp', 'Boolean'].includes(name)) {
      calls.add(name);
    }
  }
  return Array.from(calls);
}

function parseFields(block: string, lang: LangId): { name: string; type?: string }[] {
  const fields: { name: string; type?: string }[] = [];
  let re: RegExp | null = null;

  if (lang === 'typescript' || lang === 'javascript') {
    re = /(?:readonly\s+)?(?:private\s+|public\s+|protected\s+)?(\w+)\s*[?!]?\s*:\s*([\w<>\[\]|]+)/g;
  } else if (lang === 'python') {
    re = /self\.(\w+)\s*(?::\s*(\w+))?\s*=/g;
  } else if (lang === 'java' || lang === 'csharp') {
    re = /(?:private|public|protected)\s+([\w<>\[\]]+)\s+(\w+)\s*[;=]/g;
  }

  if (!re) { return fields; }
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    if (lang === 'java' || lang === 'csharp') {
      fields.push({ name: m[2], type: m[1] });
    } else {
      fields.push({ name: m[1], type: m[2] });
    }
  }
  return fields.slice(0, 30); // cap to avoid noise
}

function findDecoratorsAbove(lines: string[], lineIdx: number): string[] {
  const decs: string[] = [];
  for (let i = lineIdx - 1; i >= Math.max(0, lineIdx - 5); i--) {
    const dec = lines[i]?.match(/@(\w+)/);
    if (dec) { decs.push(dec[1]); }
    else if (lines[i]?.trim() && !lines[i]?.trim().startsWith('//') && !lines[i]?.trim().startsWith('*')) { break; }
  }
  return decs;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ARCHITECTURE LAYER AUTO-DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

function inferLayer(relPath: string, parsed: ParsedFile): NodeLayer {
  const lower = relPath.toLowerCase();
  const decs = parsed.decorators.map(d => d.toLowerCase());
  const allDecs = [...decs, ...parsed.classes.flatMap(c => c.decorators.map(d => d.toLowerCase()))];

  // Tests
  if (/\.test\.|\.spec\.|__tests__|_test\.|test_/.test(lower)) { return 'test'; }

  // Config
  if (/config|\.env|docker|\.ya?ml$|\.toml$|\.ini$|webpack|vite\.config|jest\.config|babel/.test(lower)) { return 'config'; }

  // Presentation (controllers, routes, views, components, pages)
  if (/controller|handler|route|resolver|page|view|component|screen|widget/.test(lower)) { return 'presentation'; }
  if (allDecs.some(d => ['controller', 'get', 'post', 'put', 'delete', 'resolver', 'component'].includes(d))) { return 'presentation'; }
  if (parsed.routes.length > 0) { return 'presentation'; }

  // Data layer (repositories, DAOs, migrations, schemas, ORM)
  if (/repository|repo|dao|migration|schema|seed|fixture|prisma|sequelize|typeorm/.test(lower)) { return 'data'; }
  if (allDecs.some(d => ['entity', 'table', 'column', 'model', 'schema'].includes(d))) { return 'data'; }

  // Domain (entities, models, DTOs, enums, value objects)
  if (/entity|model|dto|enum|interface|types?\/|domain|aggregate|value.?object/.test(lower)) { return 'domain'; }

  // Infrastructure (middleware, guards, pipes, interceptors, adapters, gateways)
  if (/middleware|guard|pipe|interceptor|adapter|gateway|filter|plugin|provider|factory|strategy/.test(lower)) { return 'infrastructure'; }
  if (allDecs.some(d => ['injectable', 'middleware', 'guard', 'pipe', 'interceptor'].includes(d))) { return 'infrastructure'; }

  // Business logic (services, use cases, commands, queries, jobs, workers)
  if (/service|usecase|use-case|command|query|job|worker|task|processor|manager|engine|helper/.test(lower)) { return 'business'; }
  if (allDecs.some(d => ['injectable', 'service'].includes(d))) { return 'business'; }

  return 'business'; // default
}

function inferNodeType(parsed: ParsedFile, className?: string): NodeType {
  const lower = parsed.relPath.toLowerCase();
  const decs = className
    ? parsed.classes.find(c => c.name === className)?.decorators.map(d => d.toLowerCase()) ?? []
    : parsed.decorators.map(d => d.toLowerCase());

  if (/\.test\.|\.spec\./.test(lower)) { return 'test'; }
  if (/controller/.test(lower) || decs.includes('controller')) { return 'controller'; }
  if (/service/.test(lower) || decs.includes('injectable')) { return 'service'; }
  if (/repository|repo|dao/.test(lower)) { return 'repository'; }
  if (/entity|model/.test(lower) || decs.includes('entity') || decs.includes('model')) { return 'entity'; }
  if (/middleware|guard|pipe/.test(lower)) { return 'middleware'; }
  if (parsed.routes.length > 0) { return 'controller'; }
  if (className) { return 'class'; }
  return 'file';
}

// ═══════════════════════════════════════════════════════════════════════════════
// GRAPH CONSTRUCTION
// ═══════════════════════════════════════════════════════════════════════════════

function buildStaticGraph(rootDir: string): {
  nodes: GraphNode[];
  edges: GraphEdge[];
  parsedFiles: ParsedFile[];
  languages: Set<string>;
} {
  const files = walkSourceFiles(rootDir);
  const parsedFiles: ParsedFile[] = [];
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();
  const languages = new Set<string>();

  // Parse all files
  for (const absPath of files) {
    try {
      const parsed = parseFile(absPath, rootDir);
      parsedFiles.push(parsed);
      languages.add(parsed.language);
    } catch { /* skip unparseable files */ }
  }

  // Build file-level node map for import resolution
  const fileMap = new Map<string, ParsedFile>();
  for (const pf of parsedFiles) {
    const key = pf.relPath.replace(/\.[^.]+$/, ''); // strip extension
    fileMap.set(key, pf);
    fileMap.set(pf.relPath, pf);
  }

  for (const pf of parsedFiles) {
    const layer = inferLayer(pf.relPath, pf);
    const fileId = `file:${pf.relPath}`;

    // ── File node ──
    const allMethods = [
      ...pf.functions.map(f => f.name),
      ...pf.classes.flatMap(c => c.methods.map(m => m.name)),
    ];

    nodes.push({
      id: fileId,
      label: path.basename(pf.relPath, path.extname(pf.relPath)),
      type: inferNodeType(pf),
      layer,
      description: pf.relPath,
      file: pf.relPath,
      language: pf.language,
      size: pf.classes.length > 0 ? 4 : pf.routes.length > 0 ? 4 : 3,
      methods: allMethods.slice(0, 20),
    });
    nodeIds.add(fileId);

    // ── Class nodes ──
    for (const cls of pf.classes) {
      const classId = `class:${pf.relPath}:${cls.name}`;
      nodes.push({
        id: classId,
        label: cls.name,
        type: inferNodeType(pf, cls.name),
        layer,
        description: `${cls.name} in ${pf.relPath}`,
        file: pf.relPath,
        line: cls.line,
        language: pf.language,
        size: cls.methods.length > 5 ? 5 : cls.methods.length > 2 ? 4 : 3,
        methods: cls.methods.map(m => m.name),
        fields: cls.fields.map(f => `${f.name}${f.type ? ': ' + f.type : ''}`),
        details: cls.decorators.length > 0 ? `@${cls.decorators.join(', @')}` : undefined,
      });
      nodeIds.add(classId);

      // File → defines → Class
      edges.push({ source: fileId, target: classId, type: 'defines' });

      // Class extends
      if (cls.extends) {
        const parentId = findClassId(parsedFiles, cls.extends);
        if (parentId) {
          edges.push({ source: classId, target: parentId, type: 'extends', weight: 3 });
        }
      }

      // Class implements
      for (const iface of cls.implements) {
        const ifaceId = findClassId(parsedFiles, iface);
        if (ifaceId) {
          edges.push({ source: classId, target: ifaceId, type: 'implements', weight: 2 });
        }
      }
    }

    // ── Route nodes ──
    for (const route of pf.routes) {
      const routeId = `route:${route.method}:${route.path}`;
      if (!nodeIds.has(routeId)) {
        nodes.push({
          id: routeId,
          label: `${route.method} ${route.path}`,
          type: 'route',
          layer: 'presentation',
          description: `${route.method} ${route.path} → ${pf.relPath}`,
          file: pf.relPath,
          line: route.line,
          size: 3,
        });
        nodeIds.add(routeId);
      }
      edges.push({ source: routeId, target: fileId, type: 'calls', label: 'handles' });
    }

    // ── Import edges ──
    for (const imp of pf.imports) {
      const resolved = resolveImport(pf.relPath, imp, fileMap);
      if (resolved) {
        edges.push({ source: fileId, target: `file:${resolved}`, type: 'imports' });
      }
    }

    // ── Method call edges (cross-file) ──
    const allCalls = [
      ...pf.functions.flatMap(f => f.calls),
      ...pf.classes.flatMap(c => c.methods.flatMap(m => m.calls)),
    ];
    for (const call of allCalls) {
      const targetClassId = findClassByMethod(parsedFiles, call, pf.relPath);
      if (targetClassId) {
        const sourceClassId = pf.classes.length > 0
          ? `class:${pf.relPath}:${pf.classes[0].name}`
          : fileId;
        if (sourceClassId !== targetClassId) {
          edges.push({ source: sourceClassId, target: targetClassId, type: 'calls', label: call });
        }
      }
    }
  }

  return { nodes, edges, parsedFiles, languages };
}

function findClassId(parsedFiles: ParsedFile[], className: string): string | undefined {
  for (const pf of parsedFiles) {
    const cls = pf.classes.find(c => c.name === className);
    if (cls) { return `class:${pf.relPath}:${cls.name}`; }
  }
  return undefined;
}

function findClassByMethod(parsedFiles: ParsedFile[], methodName: string, excludeFile: string): string | undefined {
  for (const pf of parsedFiles) {
    if (pf.relPath === excludeFile) { continue; }
    for (const cls of pf.classes) {
      if (cls.methods.some(m => m.name === methodName)) {
        return `class:${pf.relPath}:${cls.name}`;
      }
    }
  }
  return undefined;
}

function resolveImport(fromFile: string, imp: string, fileMap: Map<string, ParsedFile>): string | undefined {
  // Relative import
  if (imp.startsWith('.')) {
    const resolved = path.normalize(path.join(path.dirname(fromFile), imp)).replace(/\\/g, '/');
    // Try exact, then with common extensions
    for (const candidate of [resolved, `${resolved}/index`]) {
      if (fileMap.has(candidate)) { return fileMap.get(candidate)!.relPath; }
    }
  }
  return undefined;
}

// ═══════════════════════════════════════════════════════════════════════════════
// KB GRAPH (parse knowledge-base markdown)
// ═══════════════════════════════════════════════════════════════════════════════

function buildKBGraph(kbDir: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  if (!fs.existsSync(kbDir)) { return { nodes, edges }; }

  let mdFiles: string[];
  try { mdFiles = fs.readdirSync(kbDir).filter(f => f.endsWith('.md') && !f.startsWith('_')); }
  catch { return { nodes, edges }; }

  for (const file of mdFiles) {
    const content = readSafe(path.join(kbDir, file));
    if (!content || content.length < 50) { continue; }

    const parentId = `kb:${file.replace('.md', '')}`;
    const label = file.replace(/^\d+-/, '').replace('.md', '').replace(/-/g, ' ');

    nodes.push({
      id: parentId,
      label,
      type: 'kb-topic',
      layer: 'domain',
      description: extractFirstParagraph(content),
      file: `knowledge-base/${file}`,
      size: 4,
      details: content.slice(0, 800),
    });

    // Extract H2/H3 sections as child nodes
    const headings = content.match(/^#{2,3}\s+.+/gm) ?? [];
    const childIds: string[] = [];
    for (const h of headings.slice(0, 12)) {
      const text = h.replace(/^#+\s+/, '').trim();
      if (text.length < 3) { continue; }
      const childId = `kb:${file.replace('.md', '')}-${slug(text)}`;
      nodes.push({
        id: childId,
        label: text.slice(0, 45),
        type: 'kb-section',
        layer: 'domain',
        description: text,
        file: `knowledge-base/${file}`,
        size: 2,
      });
      edges.push({ source: parentId, target: childId, type: 'defines' });
      childIds.push(childId);
    }

    // Sequential flow between sections
    for (let i = 0; i < childIds.length - 1; i++) {
      edges.push({ source: childIds[i], target: childIds[i + 1], type: 'flows-to' });
    }
  }

  // Cross-link KB files that reference each other
  for (const file of mdFiles) {
    const content = readSafe(path.join(kbDir, file));
    const srcId = `kb:${file.replace('.md', '')}`;
    for (const other of mdFiles) {
      if (other === file) { continue; }
      const otherName = other.replace('.md', '').replace(/^\d+-/, '');
      if (content.toLowerCase().includes(otherName.replace(/-/g, ' '))) {
        const targetId = `kb:${other.replace('.md', '')}`;
        edges.push({ source: srcId, target: targetId, type: 'relates-to', label: 'references' });
      }
    }
  }

  return { nodes, edges };
}

function extractFirstParagraph(md: string): string {
  for (const line of md.split('\n')) {
    const t = line.trim();
    if (t && !t.startsWith('#') && !t.startsWith('|') && !t.startsWith('-') && !t.startsWith('`') && !t.startsWith('>')) {
      return t.slice(0, 200);
    }
  }
  return '';
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

export type GraphMode = 'all' | 'files' | 'classes' | 'domain' | 'routes';

export function buildGraphData(
  rootDir: string,
  mode: GraphMode | 'all' = 'all',
): GraphData {
  const t0 = Date.now();

  const allNodes: GraphNode[] = [];
  const allEdges: GraphEdge[] = [];
  const seen = new Set<string>();

  const addUnique = (ns: GraphNode[], es: GraphEdge[]) => {
    for (const n of ns) {
      if (!seen.has(n.id)) { seen.add(n.id); allNodes.push(n); }
    }
    allEdges.push(...es);
  };

  // Static analysis
  const { nodes: srcNodes, edges: srcEdges, languages } = buildStaticGraph(rootDir);

  if (mode === 'all' || mode === 'files') {
    addUnique(
      srcNodes.filter(n => n.type === 'file' || n.type === 'route'),
      srcEdges.filter(e => e.type === 'imports' || e.type === 'calls'),
    );
  }
  if (mode === 'all' || mode === 'classes') {
    addUnique(
      srcNodes.filter(n => ['class', 'interface', 'entity', 'controller', 'service', 'repository', 'middleware'].includes(n.type)),
      srcEdges.filter(e => ['defines', 'extends', 'implements', 'calls', 'injects'].includes(e.type)),
    );
  }
  if (mode === 'all' || mode === 'routes') {
    addUnique(
      srcNodes.filter(n => n.type === 'route' || n.type === 'controller'),
      srcEdges.filter(e => e.source.startsWith('route:') || e.target.startsWith('route:')),
    );
  }
  if (mode === 'all' || mode === 'domain') {
    const kbDir = path.join(rootDir, 'knowledge-base');
    const { nodes: kbNodes, edges: kbEdges } = buildKBGraph(kbDir);
    addUnique(kbNodes, kbEdges);
  }

  // Deduplicate edges
  const edgeSeen = new Set<string>();
  const uniqueEdges = allEdges.filter(e => {
    const key = `${e.source}→${e.target}→${e.type}`;
    if (edgeSeen.has(key)) { return false; }
    edgeSeen.add(key); return true;
  });

  // Remove dangling edges
  const nodeIds = new Set(allNodes.map(n => n.id));
  const validEdges = uniqueEdges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));

  // Project name
  let projectName = path.basename(rootDir);
  try {
    const pkg = JSON.parse(readSafe(path.join(rootDir, 'package.json')));
    projectName = pkg.displayName || pkg.name || projectName;
  } catch { /* ignore */ }
  // Try Cargo.toml, pyproject.toml, go.mod for non-JS projects
  if (projectName === path.basename(rootDir)) {
    try {
      const cargo = readSafe(path.join(rootDir, 'Cargo.toml'));
      const nameMatch = cargo.match(/^name\s*=\s*"([^"]+)"/m);
      if (nameMatch) { projectName = nameMatch[1]; }
    } catch { /* ignore */ }
  }

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
      languages: Array.from(languages),
      scanDurationMs: Date.now() - t0,
    },
  };
}
