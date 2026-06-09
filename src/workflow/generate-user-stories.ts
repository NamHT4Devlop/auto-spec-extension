/**
 * generate-user-stories.ts — PO/BA Epic → User Stories (Multi-Agent v2)
 *
 * INPUT:  Epic Title + Epic Description (chỉ 2 input — không cần list features)
 * OUTPUT: JSON + Interactive HTML with sprint board, impact matrix, confirmation checklist
 *
 * 7-step pipeline:
 *   1. KB Deep Investigation     — 3 agents scan domain, rules, flows
 *   2. Auto Feature Discovery    — AI splits Epic into Features from KB context
 *   3. Impact Analysis           — 1 agent per feature: old flow ↔ new flow
 *   4. Confirmation Checklist    — assumptions, missing info, ambiguities
 *   5. User Story Generation     — 1 agent per feature: stories + ACs + impact notes
 *   6. Sprint Planning           — assign sprints, validate points, sequence
 *   7. Render HTML + Save        — interactive report
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

import { log, stepHeader } from '../logger';
import { callCopilot } from '../utils/copilot';
import { loadKnowledgeBase } from '../utils/file-utils';
import { AgentOrchestrator, SubAgent } from '../utils/agent-orchestrator';
import { buildUserStoriesHtml, EpicOutput } from '../utils/html-builder';

// ─── System prompt ─────────────────────────────────────────────────────────────

const PO_SYSTEM = `\
You are a senior Business Analyst and Product Owner with 10+ years of experience.
You understand both business requirements AND technical systems deeply.

=== PRINCIPLES ===
1. Understand the INTENT (why?) before the SOLUTION (what?)
2. Each User Story: independent, delivers business value, testable, fits 1 sprint
3. Acceptance Criteria: Given/When/Then — specific, measurable, not vague
4. Always consider: happy path + edge cases + error states + permissions
5. Discover HIDDEN requirements from the knowledge base (implicit rules, side effects)
6. Identify what needs CONFIRMATION from stakeholders before development starts

=== JSON RULES ===
- Output must be valid JSON — no trailing commas, no comments
- All fields must be present, even when empty (use [] or "")`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) { fs.mkdirSync(dirPath, { recursive: true }); }
}

function extractJson(raw: string): string {
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i) ?? raw.match(/```\s*([\s\S]*?)```/);
  if (fenced) { return fenced[1].trim(); }
  const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
  if (s !== -1 && e > s) { return raw.slice(s, e + 1); }
  return raw.trim();
}

// ─── Main ──────────────────────────────────────────────────────────────────────

export async function generateUserStories(
  workspaceRoot: string,
  model: vscode.LanguageModelChat,
  token: vscode.CancellationToken,
  progress: vscode.Progress<{ message?: string; increment?: number }>,
): Promise<void> {

  const cfg = vscode.workspace.getConfiguration('autoSpecKit');
  const kbRelPath = cfg.get<string>('knowledgeBasePath', 'knowledge-base');
  const sessionsDir = cfg.get<string>('sessionsDir', 'spec-kit-sessions');

  // ── Input: chỉ Epic Title + Description ────────────────────────
  const epicTitle = await vscode.window.showInputBox({
    title: '📋 Auto Spec Kit — Epic Title',
    prompt: 'Tên Epic (heading chính trong báo cáo)',
    placeHolder: 'e.g. B2B Order Management System',
    ignoreFocusOut: true,
  });
  if (!epicTitle?.trim()) { return; }

  const epicDescription = await vscode.window.showInputBox({
    title: '📋 Auto Spec Kit — Epic Description',
    prompt: 'Mô tả Epic — problem, goals, constraints (càng chi tiết càng tốt)',
    placeHolder: 'e.g. Allow businesses to create, manage, and track bulk orders. Reduce processing time 60%.',
    ignoreFocusOut: true,
  });
  if (!epicDescription?.trim()) { return; }

  log(`\n╔═══════════════════════════════════════════════════════════════╗`);
  log(`║     📋  PO/BA USER STORIES — Multi-Agent v2                   ║`);
  log(`╚═══════════════════════════════════════════════════════════════╝`);
  log(`\nEpic     : ${epicTitle}`);
  log(`Workspace: ${workspaceRoot}`);
  log(`Model    : ${model.name}\n`);

  // ── Load KB ────────────────────────────────────────────────────
  const kb = loadKnowledgeBase(workspaceRoot, kbRelPath);
  if (!kb) {
    log(`⚠  KB not found. Run "Generate KB" first for deep analysis.`);
    log(`   Continuing with generic analysis...\n`);
  }

  const orchestrator = new AgentOrchestrator({ maxParallel: 3 });

  // ══════════════════════════════════════════════════════════════
  // STEP 1 — KB DEEP INVESTIGATION (3 parallel agents)
  // ══════════════════════════════════════════════════════════════
  stepHeader(1, 7, 'KB Deep Investigation');
  progress.report({ message: 'Step 1/7 — Investigating KB...', increment: 5 });

  const investigationAgents: SubAgent[] = [
    {
      id: 'domain-agent',
      role: 'Domain & Entity Investigator',
      priority: 3,
      systemContext: `${PO_SYSTEM}\n\n=== KNOWLEDGE BASE (domain) ===\n${kb.slice(0, 40000)}`,
      prompt: `## EPIC: "${epicTitle}"\n## DESCRIPTION: ${epicDescription}\n\n## TASK: Investigate domain entities related to this Epic.\n1. Which EXISTING entities/models will this Epic use, create, or modify?\n2. Current states/lifecycles?\n3. Relationships between them?\n4. Relevant fields?\n5. NEW entities needed?\n\nOutput as structured Markdown with KB citations.`,
    },
    {
      id: 'rules-agent',
      role: 'Business Rules Investigator',
      priority: 3,
      systemContext: `${PO_SYSTEM}\n\n=== KNOWLEDGE BASE (rules) ===\n${kb.slice(0, 40000)}`,
      prompt: `## EPIC: "${epicTitle}"\n## DESCRIPTION: ${epicDescription}\n\n## TASK: Find ALL business rules that apply.\n1. Validation rules  2. Authorization rules  3. State machine rules\n4. Calculation rules  5. Time-based rules  6. Business invariants\n\nFor each: cite KB source and explain impact on this Epic.`,
    },
    {
      id: 'flow-agent',
      role: 'Flow & Integration Investigator',
      priority: 2,
      systemContext: `${PO_SYSTEM}\n\n=== KNOWLEDGE BASE (flows) ===\n${kb.slice(0, 40000)}`,
      prompt: `## EPIC: "${epicTitle}"\n## DESCRIPTION: ${epicDescription}\n\n## TASK: Map existing flows and integrations.\n1. Which EXISTING business flows will be affected?\n2. Which API endpoints involved?\n3. Which external integrations needed?\n4. Which modules need changes?\n5. Entry points for users?\n\nTrace each affected flow end-to-end.`,
    },
  ];

  const { merged: investigation } = await orchestrator.runAndMerge(
    investigationAgents,
    'Merge all KB investigation findings into one document. Sections: 1. Related Entities  2. Business Rules  3. Affected Flows  4. Integrations  5. Affected Modules',
    model, token, PO_SYSTEM,
  );

  if (token.isCancellationRequested) { return; }

  // ══════════════════════════════════════════════════════════════
  // STEP 2 — AUTO FEATURE DISCOVERY
  // ══════════════════════════════════════════════════════════════
  stepHeader(2, 7, 'Auto Feature Discovery');
  progress.report({ message: 'Step 2/7 — Discovering features...', increment: 10 });

  const featuresRaw = await callCopilot(model, PO_SYSTEM, `\
## EPIC: "${epicTitle}"
## DESCRIPTION: ${epicDescription}

## KB INVESTIGATION:
${investigation.slice(0, 8000)}

## TASK: Break this Epic into FEATURES (3-8 features).
For each feature: id, title, description, scope (in/out), affectedEntities, affectedFlows, complexity (Low/Medium/High).
Order by dependency. Include cross-cutting feature if needed (auth, audit, migration).

Return ONLY JSON:
\`\`\`json
{ "features": [{ "id": "F1", "title": "...", "description": "...", "scope": { "in": ["..."], "out": ["..."] }, "affectedEntities": [], "affectedFlows": [], "complexity": "Medium" }] }
\`\`\``, token, 'Feature Discovery');

  let discoveredFeatures: any[];
  try {
    discoveredFeatures = JSON.parse(extractJson(featuresRaw)).features ?? [];
    log(`✅ Discovered ${discoveredFeatures.length} features`);
  } catch {
    discoveredFeatures = [{ id: 'F1', title: epicTitle, description: epicDescription, complexity: 'High', affectedEntities: [], affectedFlows: [] }];
    log(`⚠  Parse failed — using single feature fallback`);
  }

  if (token.isCancellationRequested) { return; }

  // ══════════════════════════════════════════════════════════════
  // STEP 3 — IMPACT ANALYSIS PER FEATURE (parallel)
  // ══════════════════════════════════════════════════════════════
  stepHeader(3, 7, 'Impact Analysis per Feature');
  progress.report({ message: `Step 3/7 — Impact for ${discoveredFeatures.length} features...`, increment: 15 });

  const impactAgents: SubAgent[] = discoveredFeatures.map((feat) => ({
    id: `impact-${feat.id}`,
    role: `Impact: ${feat.title}`,
    priority: 2,
    systemContext: `${PO_SYSTEM}\n\n=== KB INVESTIGATION ===\n${investigation.slice(0, 15000)}`,
    prompt: `## FEATURE: ${feat.id} — ${feat.title}\n${feat.description}\nAffected entities: ${JSON.stringify(feat.affectedEntities ?? [])}\nAffected flows: ${JSON.stringify(feat.affectedFlows ?? [])}\n\n## TASK: Impact Analysis\n### 1. EXISTING FLOW (BEFORE) — how system works today\n### 2. NEW FLOW (AFTER) — step by step: user → system → result\n### 3. DELTA / BREAKING CHANGES — data model, API, state machines, permissions, integrations\n### 4. MIGRATION / BACKWARD COMPATIBILITY — data migration? feature flag?\n### 5. DEPENDENCIES — which features must complete first? external systems?`,
  }));

  const impactResults = await orchestrator.runParallel(impactAgents, model, token);
  const impactMap = new Map<string, string>();
  for (const r of impactResults) {
    if (r.success) { impactMap.set(r.agentId.replace('impact-', ''), r.output); }
  }
  log(`✅ Impact: ${impactResults.filter(r => r.success).length}/${discoveredFeatures.length}`);

  if (token.isCancellationRequested) { return; }

  // ══════════════════════════════════════════════════════════════
  // STEP 4 — CONFIRMATION CHECKLIST
  // ══════════════════════════════════════════════════════════════
  stepHeader(4, 7, 'Confirmation Checklist');
  progress.report({ message: 'Step 4/7 — Building checklist...', increment: 10 });

  const allImpacts = Array.from(impactMap.entries())
    .map(([fid, impact]) => `## ${fid}\n${impact.slice(0, 2000)}`).join('\n\n');

  const confirmRaw = await callCopilot(model, PO_SYSTEM, `\
## EPIC: "${epicTitle}"
## FEATURES: ${discoveredFeatures.map(f => `${f.id}: ${f.title}`).join(', ')}
## IMPACT SUMMARY:
${allImpacts.slice(0, 10000)}

## TASK: Confirmation Checklist for stakeholders.
Categorize:
- 🔴 MUST CONFIRM BEFORE DEVELOPMENT (blocks dev)
- 🟡 SHOULD CLARIFY EARLY (important but non-blocking)
- 🔵 ASSUMPTIONS MADE (validate later)
- ⚪ OUT OF SCOPE (explicitly excluded)

Each item: clear question, context, askedTo (PO/Tech Lead/Designer/Security), relatedFeature.

Return JSON:
\`\`\`json
{ "mustConfirm": [{ "question": "...", "context": "...", "askedTo": "PO", "relatedFeature": "F1" }], "shouldClarify": [{ "question": "...", "askedTo": "Team" }], "assumptions": [{ "assumption": "...", "impact": "if wrong then...", "relatedFeature": "F1" }], "outOfScope": ["..."] }
\`\`\``, token, 'Confirmation Checklist');

  let confirmationData: any;
  try { confirmationData = JSON.parse(extractJson(confirmRaw)); }
  catch { confirmationData = { mustConfirm: [], shouldClarify: [], assumptions: [], outOfScope: [] }; }

  if (token.isCancellationRequested) { return; }

  // ══════════════════════════════════════════════════════════════
  // STEP 5 — USER STORY GENERATION (parallel per feature)
  // ══════════════════════════════════════════════════════════════
  stepHeader(5, 7, 'User Story Generation');
  progress.report({ message: `Step 5/7 — Writing stories for ${discoveredFeatures.length} features...`, increment: 20 });

  const storyAgents: SubAgent[] = discoveredFeatures.map((feat) => ({
    id: `stories-${feat.id}`,
    role: `Stories: ${feat.title}`,
    priority: 3,
    systemContext: PO_SYSTEM,
    prompt: `## FEATURE: ${feat.id} — ${feat.title}\n${feat.description}\n\n## IMPACT ANALYSIS:\n${impactMap.get(feat.id)?.slice(0, 4000) ?? '(N/A)'}\n\n## BUSINESS RULES:\n${investigation.slice(0, 5000)}\n\n## TASK: Write User Stories.\nEach story: id (US-${feat.id}-001), title, role, action, benefit, priority (P1/P2/P3), storyPoints (1/2/3/5/8/13), sprint, acceptanceCriteria (≥3 Given/When/Then: happy+error+edge), definitionOfDone, impactNotes (BEFORE/AFTER flow comparison), technicalNotes, apiEndpoints, dependencies.\n\nRULES: ≥3 stories/feature. Include auth story if restricted. Include error handling for critical flows. impactNotes MUST reference old vs new flow.\n\nReturn JSON:\n\`\`\`json\n{ "featureId": "${feat.id}", "stories": [{ "id": "US-${feat.id}-001", "title": "...", "role": "Customer", "action": "...", "benefit": "...", "priority": "P1", "storyPoints": 3, "sprint": 1, "acceptanceCriteria": [{ "given": "...", "when": "...", "then": "..." }], "definitionOfDone": ["..."], "impactNotes": "BEFORE: ... AFTER: ...", "technicalNotes": "...", "apiEndpoints": [], "dependencies": [] }] }\n\`\`\``,
  }));

  const storyResults = await orchestrator.runParallel(storyAgents, model, token);

  const allFeatures: any[] = [];
  let totalStories = 0;
  let totalPoints = 0;

  for (const feat of discoveredFeatures) {
    const result = storyResults.find(r => r.agentId === `stories-${feat.id}`);
    let stories: any[] = [];
    if (result?.success) {
      try { stories = JSON.parse(extractJson(result.output)).stories ?? []; }
      catch { /* empty */ }
    }
    totalStories += stories.length;
    totalPoints += stories.reduce((sum: number, s: any) => sum + (s.storyPoints ?? 0), 0);
    allFeatures.push({ id: feat.id, title: feat.title, description: feat.description, stories });
  }

  log(`✅ ${totalStories} stories, ${totalPoints} points`);
  if (token.isCancellationRequested) { return; }

  // ══════════════════════════════════════════════════════════════
  // STEP 6 — SPRINT PLANNING
  // ══════════════════════════════════════════════════════════════
  stepHeader(6, 7, 'Sprint Planning');
  progress.report({ message: 'Step 6/7 — Sprint planning...', increment: 10 });

  const sprintSummary = allFeatures.map(f =>
    `### ${f.id}: ${f.title}\n` + f.stories.map((s: any) =>
      `  ${s.id} [${s.priority}] ${s.storyPoints}pts: ${s.title} (deps: ${s.dependencies?.join(', ') || 'none'})`
    ).join('\n')
  ).join('\n\n');

  const sprintReview = await callCopilot(model, PO_SYSTEM, `\
## STORIES:\n${sprintSummary}\n\n## TASK: Sprint Planning Review\n1. P1 in Sprint 1-2?  2. Dependencies respected?  3. ~35 pts/sprint capacity  4. Sprint 1 has MVP value?\n\nRecommendations: [ADJUST/ADD/SPLIT/OK] with reasons.\nEstimated sprints: total points / 35.`, token, 'Sprint Planning');

  if (token.isCancellationRequested) { return; }

  // ══════════════════════════════════════════════════════════════
  // STEP 7 — BUILD OUTPUT
  // ══════════════════════════════════════════════════════════════
  stepHeader(7, 7, 'Rendering HTML Report');
  progress.report({ message: 'Step 7/7 — Rendering...', increment: 20 });

  const maxSprint = Math.max(1, ...allFeatures.flatMap(f => f.stories.map((s: any) => s.sprint ?? 1)));

  const epicData: EpicOutput = {
    epic: {
      title: epicTitle,
      description: epicDescription,
      businessValue: investigation.slice(0, 300),
      totalStories,
      totalPoints,
      estimatedSprints: Math.max(maxSprint, Math.ceil(totalPoints / 35)),
    },
    features: allFeatures,
    systemFindings: `${investigation.slice(0, 2000)}\n\n---\n**Sprint Planning:**\n${sprintReview}\n\n---\n**Confirmation Checklist:**\n${formatConfirmation(confirmationData)}`,
    assumptions: confirmationData.assumptions?.map((a: any) => a.assumption ?? a) ?? [],
    outOfScope: confirmationData.outOfScope ?? [],
    generatedAt: new Date().toISOString(),
    projectName: path.basename(workspaceRoot),
  };

  const html = buildUserStoriesHtml(epicData);

  const sessionsPath = path.join(workspaceRoot, sessionsDir);
  ensureDir(sessionsPath);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safeName = epicTitle.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').slice(0, 40);
  const htmlFile = path.join(sessionsPath, `user-stories-${safeName}-${timestamp}.html`);
  const jsonFile = path.join(sessionsPath, `user-stories-${safeName}-${timestamp}.json`);
  const impactFile = path.join(sessionsPath, `impact-analysis-${safeName}-${timestamp}.md`);
  const confirmFile = path.join(sessionsPath, `confirmation-${safeName}-${timestamp}.md`);

  fs.writeFileSync(htmlFile, html, 'utf-8');
  fs.writeFileSync(jsonFile, JSON.stringify(epicData, null, 2), 'utf-8');
  fs.writeFileSync(impactFile, `# Impact Analysis — ${epicTitle}\n\n${Array.from(impactMap.entries()).map(([id, imp]) => `## Feature ${id}\n\n${imp}`).join('\n\n---\n\n')}`, 'utf-8');
  fs.writeFileSync(confirmFile, `# Confirmation Checklist — ${epicTitle}\n\n${formatConfirmation(confirmationData)}`, 'utf-8');

  log(`✅ HTML:    ${path.relative(workspaceRoot, htmlFile)}`);
  log(`✅ JSON:    ${path.relative(workspaceRoot, jsonFile)}`);
  log(`✅ Impact:  ${path.relative(workspaceRoot, impactFile)}`);
  log(`✅ Confirm: ${path.relative(workspaceRoot, confirmFile)}`);

  try {
    await vscode.commands.executeCommand('simpleBrowser.show', vscode.Uri.file(htmlFile).toString());
  } catch {
    try { await vscode.env.openExternal(vscode.Uri.file(htmlFile)); }
    catch {
      const doc = await vscode.workspace.openTextDocument(htmlFile);
      await vscode.window.showTextDocument(doc, { preview: false });
    }
  }

  vscode.window.showInformationMessage(
    `✅ ${totalStories} stories · ${totalPoints} pts · ${epicData.epic.estimatedSprints} sprints · ${confirmationData.mustConfirm?.length ?? 0} to confirm`,
    'Impact Analysis', 'Confirmation Checklist',
  ).then(choice => {
    if (choice === 'Impact Analysis') {
      vscode.workspace.openTextDocument(impactFile).then(d => vscode.window.showTextDocument(d));
    } else if (choice === 'Confirmation Checklist') {
      vscode.workspace.openTextDocument(confirmFile).then(d => vscode.window.showTextDocument(d));
    }
  });

  log(`\n✅ Complete: ${totalStories} stories · ${totalPoints} pts · ${epicData.epic.estimatedSprints} sprints`);
}

// ─── Format confirmation as Markdown ──────────────────────────────────────────

function formatConfirmation(data: any): string {
  const parts: string[] = [];
  if (data.mustConfirm?.length > 0) {
    parts.push('## 🔴 MUST CONFIRM BEFORE DEVELOPMENT');
    for (const item of data.mustConfirm) {
      parts.push(`- **[${item.askedTo ?? 'PO'}]** ${item.question}`);
      if (item.context) { parts.push(`  _Context: ${item.context}_`); }
      if (item.relatedFeature) { parts.push(`  _Feature: ${item.relatedFeature}_`); }
    }
  }
  if (data.shouldClarify?.length > 0) {
    parts.push('\n## 🟡 SHOULD CLARIFY EARLY');
    for (const item of data.shouldClarify) {
      parts.push(`- **[${item.askedTo ?? 'Team'}]** ${item.question ?? item}`);
    }
  }
  if (data.assumptions?.length > 0) {
    parts.push('\n## 🔵 ASSUMPTIONS MADE');
    for (const item of data.assumptions) {
      parts.push(`- ${item.assumption ?? item}`);
      if (item.impact) { parts.push(`  _If wrong: ${item.impact}_`); }
    }
  }
  if (data.outOfScope?.length > 0) {
    parts.push('\n## ⚪ OUT OF SCOPE');
    for (const item of data.outOfScope) { parts.push(`- ${item}`); }
  }
  return parts.join('\n') || '(no items)';
}
