/**
 * graph-enricher.ts — AI-Enhanced Graph Analysis
 *
 * Takes the static GraphData from graph-builder.ts and enriches it with
 * AI-inferred relationships that static analysis cannot detect:
 *
 *   1. Business Flow Edges — "UserController.register() → AuthService.createUser() → UserRepo.save()"
 *   2. Entity Relationships — "Order belongs_to User", "Order has_many OrderItems"
 *   3. Architecture Validation — verify/correct layer classifications
 *   4. Dependency Semantics — WHY does A depend on B? (inject, compose, delegate)
 *
 * Uses AgentOrchestrator for parallel analysis.
 * This is optional — graph works without it, AI just makes it smarter.
 */

import * as vscode from 'vscode';
import { log } from '../logger';
import { AgentOrchestrator, SubAgent } from './agent-orchestrator';
import { callCopilot } from './copilot';
import { GraphData, GraphNode, GraphEdge, NodeLayer } from './graph-builder';

// ═══════════════════════════════════════════════════════════════════════════════
// AI ENRICHMENT
// ═══════════════════════════════════════════════════════════════════════════════

export async function enrichGraphWithAI(
  graph: GraphData,
  model: vscode.LanguageModelChat,
  token: vscode.CancellationToken,
): Promise<GraphData> {
  log(`\n🧠 AI Graph Enrichment: analyzing ${graph.metadata.nodeCount} nodes...`);

  const orchestrator = new AgentOrchestrator({ maxParallel: 3, mergeStrategy: 'concat' });

  // Build compact graph summary for AI context
  const graphSummary = buildGraphSummary(graph);

  const agents: SubAgent[] = [
    {
      id: 'flow-tracer',
      role: 'Business Flow Tracer',
      priority: 3,
      systemContext: 'You are a senior architect tracing business flows through a codebase graph.',
      prompt: `\
Given this project's code graph, identify the main BUSINESS FLOWS.

${graphSummary}

## TASK
Trace 3-7 key business flows through the graph. For each flow:
- Name the flow (e.g., "User Registration", "Order Checkout")
- List the sequence of nodes (classes/files) data passes through
- Note which methods are called at each step

## OUTPUT FORMAT — JSON array:
\`\`\`json
[
  {
    "name": "User Registration",
    "steps": [
      { "node": "class:src/controllers/auth.ts:AuthController", "method": "register", "action": "validates input" },
      { "node": "class:src/services/user.ts:UserService", "method": "createUser", "action": "hashes password, saves" },
      { "node": "class:src/repositories/user.ts:UserRepository", "method": "save", "action": "persists to DB" }
    ]
  }
]
\`\`\`
Use EXACT node IDs from the graph. If unsure, use the closest match. Return ONLY JSON.`,
    },
    {
      id: 'entity-mapper',
      role: 'Entity Relationship Mapper',
      priority: 3,
      systemContext: 'You are a data architect mapping entity relationships from code structure.',
      prompt: `\
Given this project's code graph, identify ENTITY RELATIONSHIPS.

${graphSummary}

## TASK
Find relationships between entity/model classes:
- belongs_to (foreign key reference)
- has_many (one-to-many)
- has_one (one-to-one)
- many_to_many

Also find:
- Which services OWN which entities (CRUD operations)
- Which controllers EXPOSE which entities via API

## OUTPUT FORMAT — JSON:
\`\`\`json
{
  "entityRelationships": [
    { "from": "class:src/entities/order.ts:Order", "to": "class:src/entities/user.ts:User", "type": "belongs_to", "field": "userId" }
  ],
  "ownership": [
    { "service": "class:src/services/order.ts:OrderService", "entity": "class:src/entities/order.ts:Order", "operations": ["create", "read", "update"] }
  ]
}
\`\`\`
Use EXACT node IDs. Return ONLY JSON.`,
    },
    {
      id: 'arch-validator',
      role: 'Architecture Layer Validator',
      priority: 1,
      systemContext: 'You are a software architect validating architecture layer classifications.',
      prompt: `\
Given this project's code graph with auto-detected layers, validate and correct classifications.

${graphSummary}

## CURRENT LAYER ASSIGNMENTS:
${graph.nodes.filter(n => n.type !== 'kb-topic' && n.type !== 'kb-section').map(n => `${n.id} → ${n.layer}`).join('\n')}

## TASK
1. Find MISCLASSIFIED nodes (wrong layer) and suggest corrections
2. Find LAYER VIOLATIONS — edges that skip layers (e.g., controller → repository directly)
3. Suggest MODULE BOUNDARIES — which classes should be grouped together

## OUTPUT FORMAT — JSON:
\`\`\`json
{
  "corrections": [
    { "nodeId": "file:src/utils/payment.ts", "currentLayer": "business", "correctLayer": "infrastructure", "reason": "payment gateway adapter" }
  ],
  "violations": [
    { "from": "class:...:Controller", "to": "class:...:Repository", "issue": "controller accesses data layer directly, bypassing service" }
  ],
  "modules": [
    { "name": "Auth Module", "nodeIds": ["class:...:AuthController", "class:...:AuthService", "class:...:UserRepository"] }
  ]
}
\`\`\`
Return ONLY JSON.`,
    },
  ];

  const results = await orchestrator.runParallel(agents, model, token);

  // ── Apply enrichments ──────────────────────────────────────────
  const enrichedNodes = [...graph.nodes];
  const enrichedEdges = [...graph.edges];
  const nodeIds = new Set(enrichedNodes.map(n => n.id));

  // Process flow tracer results
  const flowResult = results.find(r => r.agentId === 'flow-tracer');
  if (flowResult?.success) {
    const flows = parseJSON<FlowData[]>(flowResult.output, []);
    for (const flow of flows) {
      for (let i = 0; i < flow.steps.length - 1; i++) {
        const from = flow.steps[i].node;
        const to = flow.steps[i + 1].node;
        if (nodeIds.has(from) && nodeIds.has(to)) {
          enrichedEdges.push({
            source: from,
            target: to,
            type: 'flows-to',
            label: `${flow.name}: ${flow.steps[i].method ?? ''} → ${flow.steps[i + 1].method ?? ''}`,
            weight: 3,
          });
        }
      }
    }
    log(`   ✅ Flow Tracer: ${flows.length} business flows mapped`);
  }

  // Process entity mapper results
  const entityResult = results.find(r => r.agentId === 'entity-mapper');
  if (entityResult?.success) {
    const data = parseJSON<EntityData>(entityResult.output, { entityRelationships: [], ownership: [] });
    for (const rel of data.entityRelationships) {
      if (nodeIds.has(rel.from) && nodeIds.has(rel.to)) {
        enrichedEdges.push({
          source: rel.from,
          target: rel.to,
          type: 'relates-to',
          label: `${rel.type}${rel.field ? ' (' + rel.field + ')' : ''}`,
          weight: 2,
        });
      }
    }
    for (const own of data.ownership) {
      if (nodeIds.has(own.service) && nodeIds.has(own.entity)) {
        enrichedEdges.push({
          source: own.service,
          target: own.entity,
          type: 'depends',
          label: `manages (${own.operations.join(', ')})`,
          weight: 2,
        });
      }
    }
    log(`   ✅ Entity Mapper: ${data.entityRelationships.length} relationships, ${data.ownership.length} ownerships`);
  }

  // Process architecture validator results
  const archResult = results.find(r => r.agentId === 'arch-validator');
  if (archResult?.success) {
    const data = parseJSON<ArchData>(archResult.output, { corrections: [], violations: [], modules: [] });

    // Apply layer corrections
    for (const fix of data.corrections) {
      const node = enrichedNodes.find(n => n.id === fix.nodeId);
      if (node && isValidLayer(fix.correctLayer)) {
        node.layer = fix.correctLayer as NodeLayer;
      }
    }

    // Add violation edges (as visual warnings)
    for (const v of data.violations) {
      if (nodeIds.has(v.from) && nodeIds.has(v.to)) {
        // Mark existing edge or add annotation
        const existing = enrichedEdges.find(e => e.source === v.from && e.target === v.to);
        if (existing) {
          existing.label = `⚠️ ${v.issue}`;
        }
      }
    }

    // Create module group nodes
    for (const mod of data.modules) {
      const moduleId = `module:${slug(mod.name)}`;
      enrichedNodes.push({
        id: moduleId,
        label: mod.name,
        type: 'module',
        layer: 'business',
        description: `Module: ${mod.name} (${mod.nodeIds.length} components)`,
        size: 5,
      });
      nodeIds.add(moduleId);
      for (const childId of mod.nodeIds) {
        if (nodeIds.has(childId)) {
          enrichedEdges.push({ source: moduleId, target: childId, type: 'defines' });
        }
      }
    }

    log(`   ✅ Arch Validator: ${data.corrections.length} corrections, ${data.violations.length} violations, ${data.modules.length} modules`);
  }

  // Deduplicate edges
  const edgeSeen = new Set<string>();
  const finalEdges = enrichedEdges.filter(e => {
    const key = `${e.source}→${e.target}→${e.type}`;
    if (edgeSeen.has(key)) { return false; }
    edgeSeen.add(key);
    return nodeIds.has(e.source) && nodeIds.has(e.target);
  });

  log(`🧠 Enrichment complete: ${enrichedNodes.length} nodes (+${enrichedNodes.length - graph.nodes.length}), ${finalEdges.length} edges (+${finalEdges.length - graph.edges.length})`);

  return {
    ...graph,
    nodes: enrichedNodes,
    edges: finalEdges,
    metadata: {
      ...graph.metadata,
      nodeCount: enrichedNodes.length,
      edgeCount: finalEdges.length,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function buildGraphSummary(graph: GraphData): string {
  const classNodes = graph.nodes.filter(n =>
    ['class', 'entity', 'controller', 'service', 'repository', 'middleware'].includes(n.type)
  );
  const fileNodes = graph.nodes.filter(n => n.type === 'file');
  const routeNodes = graph.nodes.filter(n => n.type === 'route');

  const parts: string[] = [];
  parts.push(`## PROJECT: ${graph.metadata.projectName}`);
  parts.push(`Languages: ${graph.metadata.languages.join(', ')}`);
  parts.push(`Total: ${graph.metadata.nodeCount} nodes, ${graph.metadata.edgeCount} edges\n`);

  if (classNodes.length > 0) {
    parts.push(`## CLASSES (${classNodes.length}):`);
    for (const n of classNodes.slice(0, 80)) {
      parts.push(`- **${n.label}** [${n.type}/${n.layer}] ${n.file ?? ''}`);
      if (n.description && !n.description.includes(' — ')) {
        parts.push(`  desc: ${n.description}`);
      }
      if (n.details) { parts.push(`  annotations: ${n.details}`); }
      if (n.methods?.length) { parts.push(`  methods: ${n.methods.slice(0, 12).join(', ')}`); }
      if (n.fields?.length) { parts.push(`  fields: ${n.fields.slice(0, 8).join(', ')}`); }
    }
  }

  if (routeNodes.length > 0) {
    parts.push(`\n## API ROUTES (${routeNodes.length}):`);
    for (const n of routeNodes.slice(0, 30)) {
      parts.push(`- ${n.label} → ${n.description}`);
    }
  }

  if (fileNodes.length > 0) {
    parts.push(`\n## FILES (${fileNodes.length}):`);
    for (const n of fileNodes.slice(0, 40)) {
      parts.push(`- ${n.id} [${n.layer}] ${n.methods?.length ? `(${n.methods.slice(0, 5).join(', ')})` : ''}`);
    }
  }

  // DI injection edges — most meaningful for Java/Spring/NestJS architecture
  const injectionEdges = graph.edges.filter(e => e.type === 'injects');
  if (injectionEdges.length > 0) {
    parts.push(`\n## DEPENDENCY INJECTIONS (${injectionEdges.length}):`);
    for (const e of injectionEdges.slice(0, 60)) {
      parts.push(`- ${e.source} —[injects]→ ${e.target} (field: ${e.label ?? ''})`);
    }
  }

  // Class hierarchy + calls
  const importantEdges = graph.edges.filter(e =>
    e.type === 'extends' || e.type === 'implements' || e.type === 'calls'
  );
  if (importantEdges.length > 0) {
    parts.push(`\n## KEY RELATIONSHIPS (${importantEdges.length}):`);
    for (const e of importantEdges.slice(0, 50)) {
      parts.push(`- ${e.source} —[${e.type}]→ ${e.target}${e.label ? ' (' + e.label + ')' : ''}`);
    }
  }

  return parts.join('\n');
}

function parseJSON<T>(raw: string, fallback: T): T {
  try {
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const text = match ? match[1] : raw;
    const start = text.indexOf('{') !== -1 ? text.indexOf('{') : text.indexOf('[');
    const end = text.lastIndexOf('}') !== -1 ? text.lastIndexOf('}') : text.lastIndexOf(']');
    if (start === -1 || end === -1) { return fallback; }
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return fallback;
  }
}

function isValidLayer(layer: string): boolean {
  return ['presentation', 'business', 'data', 'infrastructure', 'domain', 'test', 'config', 'external'].includes(layer);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

// ── Types for AI response parsing ─────────────────────────────────────────────

interface FlowData {
  name: string;
  steps: { node: string; method?: string; action?: string }[];
}

interface EntityData {
  entityRelationships: { from: string; to: string; type: string; field?: string }[];
  ownership: { service: string; entity: string; operations: string[] }[];
}

interface ArchData {
  corrections: { nodeId: string; currentLayer: string; correctLayer: string; reason: string }[];
  violations: { from: string; to: string; issue: string }[];
  modules: { name: string; nodeIds: string[] }[];
}
