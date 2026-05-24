/**
 * generate-user-stories.ts
 * PO/BA workflow: Epic + Feature(s) → KB investigation → User Stories JSON → HTML report.
 *
 * Flow:
 *   STEP 1  Investigate KB — which modules, entities, roles are relevant to this epic
 *   STEP 2  Generate structured User Stories as EpicOutput JSON
 *   STEP 3  Sprint planning pass — assign sprints, validate points, detect conflicts
 *   STEP 4  Render HTML, save to sessionsDir, open in browser/preview
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

import { log, stepHeader } from '../logger';
import { callCopilot } from '../utils/copilot';
import { loadKnowledgeBase } from '../utils/file-utils';
import { buildUserStoriesHtml, EpicOutput } from '../utils/html-builder';

// ─── System prompt ─────────────────────────────────────────────────────────────

const PO_SYSTEM = `\
You are a senior Business Analyst and Product Owner with 10+ years of experience.
Your mission: analyze requirements from the PO, cross-reference with the existing system, and write User Stories that meet Agile standards.

=== ANALYSIS PRINCIPLES ===
1. Understand the INTENT (why?) before writing the SOLUTION (what?)
2. Each User Story must be: independent, deliver business value, testable, and deliverable in 1 sprint
3. Acceptance Criteria follow the Given/When/Then standard — specific, not vague
4. Always consider: happy path + edge cases + error states + permission/role
5. Discover hidden requirements from the knowledge base (implicit business rules, integrations, side effects)

=== WRITING STYLE ===
- User Story format: "As a [role], I want to [action], so that [benefit]"
- AC: concise, measurable, no repetition of code details
- Technical Notes: only what the PO needs to know to work with dev
- Priority: P1 = MVP/blocker, P2 = important, P3 = nice-to-have

=== JSON OUTPUT RULES ===
- Output JSON MUST be valid — no trailing commas, no comments inside JSON
- String values must not contain newline characters (\n) — use arrays if multiple lines are needed
- All fields in the schema MUST be present, even when empty (use [] or "")`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Extract JSON from a Copilot response that may have markdown code fences.
 * Tries ```json ... ``` first, then ``` ... ```, then bare { } extraction.
 */
function extractJson(raw: string): string {
  // Try ```json fenced block
  const fencedJson = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fencedJson) { return fencedJson[1].trim(); }

  // Try plain ``` block
  const fenced = raw.match(/```\s*([\s\S]*?)```/);
  if (fenced) { return fenced[1].trim(); }

  // Try extracting the outermost { ... }
  const braceStart = raw.indexOf('{');
  const braceEnd   = raw.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    return raw.slice(braceStart, braceEnd + 1);
  }

  return raw.trim();
}

// ─── Main exported function ────────────────────────────────────────────────────

export async function generateUserStories(
  workspaceRoot: string,
  model: vscode.LanguageModelChat,
  token: vscode.CancellationToken,
  progress: vscode.Progress<{ message?: string; increment?: number }>,
): Promise<void> {

  const cfg        = vscode.workspace.getConfiguration('autoSpecKit');
  const kbRelPath  = cfg.get<string>('knowledgeBasePath', 'knowledge-base');
  const sessionsDir = cfg.get<string>('sessionsDir', 'spec-kit-sessions');

  // ── Gather inputs ─────────────────────────────────────────────────
  const epicTitle = await vscode.window.showInputBox({
    title:          '📋 Auto Spec Kit — PO/BA: Epic Title',
    prompt:         'Epic name (will be used as the main heading in the HTML report)',
    placeHolder:    'e.g. B2B Order Management System',
    ignoreFocusOut: true,
  });
  if (!epicTitle?.trim()) { return; }

  const epicDescription = await vscode.window.showInputBox({
    title:          '📋 Auto Spec Kit — PO/BA: Epic Description',
    prompt:         'Epic description — problem to solve + business objectives (can be long)',
    placeHolder:    'e.g. Allow businesses to create, manage, and track bulk orders. Goal: reduce order processing time by 60%.',
    ignoreFocusOut: true,
  });
  if (!epicDescription?.trim()) { return; }

  const featuresRaw = await vscode.window.showInputBox({
    title:          '📋 Auto Spec Kit — PO/BA: Feature List',
    prompt:         'List the Features (one feature per line or separated by ;)',
    placeHolder:    'e.g. Bulk order creation; Order status management; Reporting and CSV export',
    ignoreFocusOut: true,
  });
  if (!featuresRaw?.trim()) { return; }

  const features = featuresRaw
    .split(/[;\n]/)
    .map(f => f.trim())
    .filter(Boolean);

  // ── Log header ────────────────────────────────────────────────────
  log(`\n╔═══════════════════════════════════════════════════════════════╗`);
  log(`║         📋  AUTO SPEC KIT — PO/BA: USER STORIES               ║`);
  log(`╚═══════════════════════════════════════════════════════════════╝`);
  log(`\nEpic    : ${epicTitle}`);
  log(`Features: ${features.join(', ')}`);
  log(`Workspace: ${workspaceRoot}`);
  log(`Model    : ${model.name}  [${model.id}]\n`);

  // ── STEP 1: KB Investigation ───────────────────────────────────────
  stepHeader(1, 4, 'KB INVESTIGATION — System Analysis');
  progress.report({ message: 'STEP 1/4 — Investigating Knowledge Base...', increment: 5 });

  const kb = loadKnowledgeBase(workspaceRoot, kbRelPath);
  if (!kb) {
    log(`⚠  Knowledge Base not found at "${kbRelPath}".`);
    log(`   Run "Generate Knowledge Base" (Cmd+Shift+B) first for full context.`);
    log(`   Continuing with generic analysis...\n`);
  } else {
    log(`✅ Knowledge Base loaded (${(kb.length / 1024).toFixed(1)}KB)\n`);
  }

  const investigationPrompt = `\
# Epic Analysis: "${epicTitle}"

## Epic Description:
${epicDescription}

## Features to implement:
${features.map((f, i) => `${i + 1}. ${f}`).join('\n')}

---

## ANALYSIS TASK

Based on the project Knowledge Base, analyze and answer in detail:

### 1. Related System Entities
List the entities/models/tables in the existing system that this Epic will use or create.
For each entity: name, purpose, status (existing / new / modified).

### 2. Business Rules to Follow
List the business rules from the KB that User Stories MUST respect.
Examples: validation rules, state machine constraints, authorization rules, calculation formulas.

### 3. Actors / Roles
Who are the users of this Epic? List roles with their related permissions.

### 4. Integration Points
Services, APIs, or third-party systems that this Epic will touch.

### 5. Existing Modules Affected
Existing modules/features that may be impacted, need updating, or require backward compatibility.

### 6. Hidden Requirements
Requirements not directly mentioned but implied by the system context:
- Security & authorization
- Audit trail / logging
- Error handling & rollback
- Performance constraints
- Data migration needs

### 7. Out of Scope (suggested)
What should NOT be done in this Epic to keep scope manageable.

### 8. Assumptions
Assumptions that need to be confirmed with stakeholders before development.

Format: concise, use bullet points, cite actual module/file names from KB when possible.`;

  const investigationResult = await callCopilot(
    model, PO_SYSTEM, investigationPrompt, token, 'KB Investigation'
  );
  log(investigationResult);

  if (token.isCancellationRequested) { return; }

  // ── STEP 2: Generate User Stories as JSON ─────────────────────────
  stepHeader(2, 4, 'GENERATING USER STORIES — Structured JSON Output');
  progress.report({ message: 'STEP 2/4 — Generating User Stories...', increment: 20 });

  const featuresList = features.map((f, i) => `F${i + 1}: ${f}`).join('\n');

  const storiesPrompt = `\
# Generate User Stories: "${epicTitle}"

## Epic:
${epicDescription}

## Features:
${featuresList}

## System Analysis (from STEP 1):
${investigationResult}

---

## TASK

Write complete User Stories for the Epic above. Output must be PURE JSON (no text before or after).

## JSON SCHEMA (REQUIRED — correct types, all fields present):

\`\`\`json
{
  "epic": {
    "title": "string — epic name",
    "description": "string — short description (1-2 sentences)",
    "businessValue": "string — specific business value (metric if available)",
    "totalStories": 0,
    "totalPoints": 0,
    "estimatedSprints": 0
  },
  "features": [
    {
      "id": "F1",
      "title": "string",
      "description": "string — feature purpose, not how to implement",
      "stories": [
        {
          "id": "US-001",
          "featureId": "F1",
          "title": "string — concise, action-oriented",
          "role": "string — Customer / Admin / System / ...",
          "action": "string — specific action (no 'I want to')",
          "benefit": "string — value received (no 'so that')",
          "priority": "P1",
          "storyPoints": 3,
          "sprint": 1,
          "acceptanceCriteria": [
            {
              "given": "string — initial state",
              "when": "string — action that occurs",
              "then": "string — expected result (observable, testable)"
            }
          ],
          "definitionOfDone": [
            "string — specific done condition (e.g., Unit test coverage >= 80%)"
          ],
          "dependencies": ["US-002"],
          "technicalNotes": "string — technical notes for dev (leave empty if none)",
          "apiEndpoints": ["POST /api/v1/orders"],
          "affectedModules": ["OrderModule", "InventoryModule"]
        }
      ]
    }
  ],
  "systemFindings": "string — summary of findings from KB analysis (2-3 sentences)",
  "assumptions": [
    "string — assumption to confirm"
  ],
  "outOfScope": [
    "string — explicitly NOT in scope for this epic"
  ],
  "generatedAt": "string — ISO timestamp",
  "projectName": "string — project name from KB or 'Unknown'"
}
\`\`\`

## RULES:
1. Write at least 3 ACs per story (happy path + edge case + error state)
2. Each feature has at least 2 stories
3. Story points: 1=trivial, 2=simple, 3=medium, 5=complex, 8=very complex, 13=should split
4. Sprint 1 = MVP/P1 stories, Sprint 2 = important P2, Sprint 3+ = P3 / nice-to-have
5. Fill totalStories, totalPoints, estimatedSprints accurately (count/calculate from data)
6. generatedAt = "${new Date().toISOString()}"
7. Always include at least 1 story for: authentication/authorization if relevant, error handling, audit/logging if KB mentions it
8. JSON must be valid — test by parsing before output

Output pure JSON, starting with { and ending with }`;

  const storiesRaw = await callCopilot(
    model, PO_SYSTEM, storiesPrompt, token, 'Generate User Stories JSON'
  );

  if (token.isCancellationRequested) { return; }

  // ── STEP 3: Sprint Planning & Validation ──────────────────────────
  stepHeader(3, 4, 'SPRINT PLANNING — Validate & Optimize');
  progress.report({ message: 'STEP 3/4 — Sprint planning & validation...', increment: 20 });

  // Parse JSON from Copilot response
  let epicData: EpicOutput;
  let jsonStr = extractJson(storiesRaw);

  try {
    epicData = JSON.parse(jsonStr) as EpicOutput;
    log(`✅ JSON parsed: ${epicData.features.length} features, ${epicData.epic.totalStories} stories\n`);
  } catch (parseErr) {
    // If parse fails, ask Copilot to fix the JSON
    log(`⚠  JSON parse error: ${parseErr}. Asking Copilot to fix...\n`);

    const fixPrompt = `\
The JSON below has syntax errors. Fix ONLY the syntax errors and return valid JSON.
Do not add or remove data.

JSON with errors:
\`\`\`
${jsonStr.slice(0, 8000)}
\`\`\`

Return ONLY the corrected JSON (no text before or after).`;

    const fixedRaw = await callCopilot(
      model, 'You are a JSON syntax fixer. Return only valid JSON, no explanations.',
      fixPrompt, token, 'Fix JSON'
    );
    jsonStr = extractJson(fixedRaw);

    try {
      epicData = JSON.parse(jsonStr) as EpicOutput;
      log(`✅ JSON fixed and parsed successfully\n`);
    } catch (e2) {
      log(`❌ JSON still invalid after fix attempt. Generating with minimal data...\n`);
      // Create a minimal valid structure so we can still show something
      epicData = createFallbackEpic(epicTitle, epicDescription, features, storiesRaw);
    }
  }

  // Sprint planning validation prompt
  const sprintPrompt = `\
# Sprint Planning Review: "${epicData.epic.title}"

These are the generated User Stories. Please review and suggest adjustments:

## Summary
- Total Stories: ${epicData.epic.totalStories}
- Total Points: ${epicData.epic.totalPoints}
- Estimated Sprints: ${epicData.epic.estimatedSprints}

## Distribution by Sprint:
${getSprintDistribution(epicData)}

## Review checklist:
1. **Dependencies**: Are any stories that depend on each other assigned to the same sprint? → Adjust sprint
2. **Sprint capacity**: Assuming 1 sprint = 2 weeks, team of 3-4 devs, capacity ~30-40 points/sprint. Is any sprint overloaded?
3. **MVP completeness**: Does Sprint 1 deliver enough value for users?
4. **P1 stories**: Are all P1 stories in Sprint 1-2?
5. **Missing stories**: Are there any hidden requirements from the analysis that don't have a story yet?

## Recommendations:
List specific adjustments to make (if any). Format:
- [ADJUST] US-XXX: Sprint X → Sprint Y (reason)
- [ADD] Missing story: [short description] belonging to Feature FX
- [SPLIT] US-XXX should be split into 2 stories because [reason]
- [OK] If everything looks good

Note: Only provide recommendations, do NOT regenerate JSON.`;

  const sprintReview = await callCopilot(
    model, PO_SYSTEM, sprintPrompt, token, 'Sprint Planning Review'
  );
  log(`\n📊 Sprint Planning Review:\n${sprintReview}\n`);

  if (token.isCancellationRequested) { return; }

  // ── STEP 4: Render HTML & Save ────────────────────────────────────
  stepHeader(4, 4, 'RENDERING HTML REPORT');
  progress.report({ message: 'STEP 4/4 — Rendering HTML report...', increment: 40 });

  // Inject sprint planning notes into systemFindings
  epicData.systemFindings = `${epicData.systemFindings || ''}\n\n---\n**Sprint Planning Notes:**\n${sprintReview}`.trim();

  // Ensure generatedAt is set
  if (!epicData.generatedAt) {
    epicData.generatedAt = new Date().toISOString();
  }

  // Build HTML
  const html = buildUserStoriesHtml(epicData);

  // Save to sessions directory
  const sessionsPath = path.join(workspaceRoot, sessionsDir);
  ensureDir(sessionsPath);

  const timestamp  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safeName   = epicTitle.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').slice(0, 40);
  const htmlFile   = path.join(sessionsPath, `user-stories-${safeName}-${timestamp}.html`);
  const jsonFile   = path.join(sessionsPath, `user-stories-${safeName}-${timestamp}.json`);

  fs.writeFileSync(htmlFile, html, 'utf-8');
  fs.writeFileSync(jsonFile, JSON.stringify(epicData, null, 2), 'utf-8');

  log(`✅ HTML saved: ${path.relative(workspaceRoot, htmlFile)}`);
  log(`✅ JSON saved: ${path.relative(workspaceRoot, jsonFile)}`);

  // Open HTML in VS Code browser preview or external browser
  const htmlUri = vscode.Uri.file(htmlFile);
  try {
    // Try to open with Simple Browser (built-in VS Code preview)
    await vscode.commands.executeCommand('simpleBrowser.show', htmlUri.toString());
    log(`✅ Opened in VS Code Simple Browser`);
  } catch {
    // Fallback: open as text document
    try {
      await vscode.env.openExternal(htmlUri);
      log(`✅ Opened in external browser`);
    } catch {
      const doc = await vscode.workspace.openTextDocument(htmlFile);
      await vscode.window.showTextDocument(doc, { preview: false });
      log(`✅ Opened as text document`);
    }
  }

  // Show summary notification
  const storyCount = epicData.features.reduce((sum, f) => sum + (f.stories?.length ?? 0), 0);
  vscode.window.showInformationMessage(
    `✅ User Stories: ${storyCount} stories · ${epicData.epic.totalPoints} points · ${epicData.epic.estimatedSprints} sprints`,
    'Open HTML'
  ).then(choice => {
    if (choice === 'Open HTML') {
      vscode.env.openExternal(htmlUri);
    }
  });

  log(`\n✅ User Stories workflow complete!`);
  log(`   Stories : ${storyCount}`);
  log(`   Points  : ${epicData.epic.totalPoints}`);
  log(`   Sprints : ${epicData.epic.estimatedSprints}`);
  log(`   HTML    : ${htmlFile}`);
}

// ─── Sprint distribution helper ───────────────────────────────────────────────

function getSprintDistribution(data: EpicOutput): string {
  const map: Record<number, { count: number; points: number }> = {};
  for (const feature of data.features) {
    for (const story of feature.stories || []) {
      const s = story.sprint ?? 1;
      if (!map[s]) { map[s] = { count: 0, points: 0 }; }
      map[s].count++;
      map[s].points += story.storyPoints ?? 0;
    }
  }
  return Object.entries(map)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([sprint, { count, points }]) => `Sprint ${sprint}: ${count} stories, ${points} points`)
    .join('\n');
}

// ─── Fallback epic when JSON is completely unparseable ────────────────────────

function createFallbackEpic(
  title: string,
  description: string,
  features: string[],
  rawContent: string,
): EpicOutput {
  return {
    epic: {
      title,
      description,
      businessValue: 'See raw content below',
      totalStories:  0,
      totalPoints:   0,
      estimatedSprints: 1,
    },
    features: features.map((f, i) => ({
      id: `F${i + 1}`,
      title: f,
      description: f,
      stories: [],
    })),
    systemFindings: `⚠️ JSON generation failed. Raw Copilot output:\n\n${rawContent.slice(0, 3000)}`,
    assumptions:    ['JSON parse failed — please review raw output above'],
    outOfScope:     [],
    generatedAt:    new Date().toISOString(),
    projectName:    'Unknown',
  };
}
