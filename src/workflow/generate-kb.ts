/**
 * generate-kb.ts — Multi-Agent Knowledge Base Generation
 *
 * Architecture:
 *   1. Project scan (file tree + source content)
 *   2. Batch-parallel KB steps — independent steps run simultaneously
 *   3. Critical business steps (04, 05, 10, 13) use per-step multi-agent:
 *      - Service/Controller Agent — reads business logic layer
 *      - Test/Validation Agent   — reads tests + validators (reveals intent)
 *      - Model/Schema Agent      — reads entities, migrations, types
 *      → Merge Agent synthesizes into one deep analysis
 *   4. Review Skills generation (universal template + Section 14)
 *
 * Batches (steps within a batch run in parallel):
 *   Batch 1: [01 structure, 02 tech stack, 03 entry points]           — foundation
 *   Batch 2: [04★ business domain, 05★ domain model, 06 modules]      — business core (★ = multi-agent)
 *   Batch 3: [07 architecture, 08 database, 09 auth]                  — infrastructure
 *   Batch 4: [10★ core flows, 11 api docs, 12 conventions]            — flows & patterns
 *   Batch 5: [13★ business rules, 14 integrations, 15 errors]         — rules & operations
 *   Final:   [review-skills.md]                                       — Section 14
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

import { log, kbHeader, banner } from '../logger';
import { callCopilot } from '../utils/copilot';
import { scanProject } from '../utils/project-scanner';
import { AgentOrchestrator, SubAgent } from '../utils/agent-orchestrator';
import { KB_STEPS, KbStep } from '../constants/kb-steps';

// ─── Critical steps that get multi-agent deep analysis ────────────────────────

const DEEP_ANALYSIS_STEPS = new Set([
  '04-business-domain.md',
  '05-domain-model.md',
  '10-core-flows.md',
  '13-business-rules.md',
]);

// ─── Batch definitions (steps within a batch run in parallel) ─────────────────

const BATCHES: number[][] = [
  [0, 1, 2],       // Batch 1: structure, tech stack, entry points
  [3, 4, 5],       // Batch 2: business domain★, domain model★, modules
  [6, 7, 8],       // Batch 3: architecture, database, auth
  [9, 10, 11],     // Batch 4: core flows★, api docs, conventions
  [12, 13, 14],    // Batch 5: business rules★, integrations, errors
];

// ─── Source file categorization for multi-agent context splitting ──────────────

interface SourceSlice {
  services: string;
  tests: string;
  models: string;
}

function sliceProjectScan(fullScan: string): SourceSlice {
  const lines = fullScan.split('\n');
  const services: string[] = [];
  const tests: string[] = [];
  const models: string[] = [];

  let currentFile = '';
  let currentContent: string[] = [];

  const flush = () => {
    if (!currentFile) { return; }
    const block = currentContent.join('\n');
    const lower = currentFile.toLowerCase();

    if (/\.test\.|\.spec\.|__tests__|test_/.test(lower)) {
      tests.push(block);
    } else if (/service|controller|handler|resolver|route|middleware|guard|interceptor|use-?case|command|query/.test(lower)) {
      services.push(block);
    } else if (/entity|model|schema|migration|dto|interface|type|enum|prisma|\.sql/.test(lower)) {
      models.push(block);
    } else {
      // Put config/util/other files in services bucket (general context)
      services.push(block);
    }
  };

  for (const line of lines) {
    if (line.startsWith('## FILE:')) {
      flush();
      currentFile = line;
      currentContent = [line];
    } else {
      currentContent.push(line);
    }
  }
  flush();

  const cap = (arr: string[], maxChars: number) => {
    let total = 0;
    const result: string[] = [];
    for (const s of arr) {
      if (total + s.length > maxChars) { break; }
      result.push(s);
      total += s.length;
    }
    return result.join('\n\n');
  };

  return {
    services: cap(services, 150_000),
    tests: cap(tests, 100_000),
    models: cap(models, 100_000),
  };
}

// ─── Deep multi-agent analysis for a single KB step ───────────────────────────

async function deepAnalyzeStep(
  step: KbStep,
  kbSystem: string,
  slices: SourceSlice,
  model: vscode.LanguageModelChat,
  token: vscode.CancellationToken,
): Promise<string> {
  const orchestrator = new AgentOrchestrator({ maxParallel: 3, mergeStrategy: 'ai' });

  const agents: SubAgent[] = [
    {
      id: 'service-agent',
      role: 'Service & Controller Analyzer',
      priority: 2,
      systemContext: `You are analyzing the SERVICE/CONTROLLER layer to answer business questions.\n\nFocus on: function names, method signatures, orchestration logic, API routes, middleware.\n\n=== SERVICE/CONTROLLER SOURCE ===\n${slices.services.slice(0, 60_000)}`,
      prompt: `${step.prompt}\n\nFocus your analysis on the SERVICE and CONTROLLER layer. Cite actual function names, file paths, and line references. Explain the BUSINESS PURPOSE of each service method you find.`,
    },
    {
      id: 'test-agent',
      role: 'Test & Validation Analyzer',
      priority: 3,
      systemContext: `You are analyzing TEST FILES and VALIDATORS to infer business rules and intent.\n\nTests reveal what the developers consider important business scenarios.\nValidators reveal what constraints the business enforces.\n\n=== TEST & VALIDATION SOURCE ===\n${slices.tests.slice(0, 60_000)}`,
      prompt: `${step.prompt}\n\nFocus your analysis on TEST FILES and VALIDATION LOGIC. For each test:\n- What business scenario does it verify?\n- What business rule does the assertion enforce?\n- What edge case does it protect against?\n\nTests are the most reliable source of business intent — treat them as specifications.`,
    },
    {
      id: 'model-agent',
      role: 'Model & Schema Analyzer',
      priority: 2,
      systemContext: `You are analyzing ENTITY/MODEL/SCHEMA/MIGRATION files to understand the data domain.\n\n=== MODEL & SCHEMA SOURCE ===\n${slices.models.slice(0, 60_000)}`,
      prompt: `${step.prompt}\n\nFocus your analysis on ENTITIES, MODELS, SCHEMAS, MIGRATIONS, and TYPE DEFINITIONS:\n- What real-world concepts do entities represent?\n- What state machines exist (status/state fields)?\n- What business constraints are enforced at the data layer (unique, not-null, check)?\n- What relationships exist and what do they mean in business terms?\n- What does the migration history reveal about business evolution?`,
    },
  ];

  const mergeInstruction = `\
You are producing the definitive "${step.label}" analysis by merging insights from 3 specialist agents who each analyzed different code layers.

## MERGE RULES:
1. SYNTHESIZE — Don't just concatenate. Weave all perspectives into ONE coherent analysis.
2. EVIDENCE — Every claim must cite a file path + function/class name. Remove any claim without evidence.
3. BUSINESS DEPTH — Explain WHY code exists (business reason), not just WHAT it does.
4. CROSS-REFERENCE — When the Service Agent found a method and the Test Agent found its test, connect them.
5. COMPLETENESS — If one agent found something the others missed, include it.
6. NO GENERIC STATEMENTS — If not found in codebase, say "not found in codebase".

Produce the final analysis in well-structured Markdown.`;

  const { merged } = await orchestrator.runAndMerge(
    agents, mergeInstruction, model, token, kbSystem,
  );

  return merged;
}

// ─── Main exported function ───────────────────────────────────────────────────

export async function generateKnowledgeBase(
  workspaceRoot: string,
  model: vscode.LanguageModelChat,
  token: vscode.CancellationToken,
  progress: vscode.Progress<{ message?: string; increment?: number }>,
  extensionPath: string
): Promise<void> {

  const cfg = vscode.workspace.getConfiguration('autoSpecKit');
  const kbRelPath = cfg.get<string>('knowledgeBasePath', 'knowledge-base');
  const maxParallel = cfg.get<number>('agents.maxParallel', 3);
  const kbPath = path.join(workspaceRoot, kbRelPath);

  // ── Check existing KB ──────────────────────────────────────────
  if (fs.existsSync(kbPath)) {
    const existingFiles = fs.readdirSync(kbPath).filter(f => f.endsWith('.md'));
    if (existingFiles.length > 0) {
      const choice = await vscode.window.showQuickPick(
        [
          { label: `🔄 Regenerate KB (overwrite ${existingFiles.length} existing files)`, overwrite: true },
          { label: '❌ Cancel — Keep existing KB', overwrite: false },
        ],
        {
          title: '⚠️ Knowledge Base already exists!',
          placeHolder: `${kbRelPath}/ already has ${existingFiles.length} files. Regenerate from scratch?`,
        }
      );
      if (!choice?.overwrite) {
        log('⏭  KB generation cancelled.');
        return;
      }
    }
  }

  fs.mkdirSync(kbPath, { recursive: true });

  banner([
    '📚  AUTO SPEC KIT — GENERATE KNOWLEDGE BASE',
    `Multi-Agent Mode · maxParallel=${maxParallel}`,
  ]);
  log(`Workspace : ${workspaceRoot}`);
  log(`KB Path   : ${kbPath}`);
  log(`Model     : ${model.name}\n`);

  // ── Scan project ───────────────────────────────────────────────
  log('📂 Scanning project files...');
  progress.report({ message: 'Scanning project...', increment: 3 });
  const projectScan = scanProject(workspaceRoot);

  fs.writeFileSync(
    path.join(kbPath, '_project-scan.md'),
    `# Project Scan\n_Auto-generated by Auto Spec Kit — do not edit_\n\n${projectScan}`,
    'utf-8'
  );
  log('✅ Project scan saved to _project-scan.md');

  // ── Slice source for multi-agent deep analysis ─────────────────
  log('🔪 Slicing source code by layer (services / tests / models)...');
  const slices = sliceProjectScan(projectScan);
  log(`   Services/Controllers: ${(slices.services.length / 1024).toFixed(0)}KB`);
  log(`   Tests/Validators:     ${(slices.tests.length / 1024).toFixed(0)}KB`);
  log(`   Models/Schemas:       ${(slices.models.length / 1024).toFixed(0)}KB`);

  // ── System context ─────────────────────────────────────────────
  const KB_SYSTEM = `\
You are a Principal Software Engineer and Business Analyst hired to deeply understand this codebase.

Your mission is NOT just to describe the code — but to understand WHY the code exists and WHAT PROBLEM IT SOLVES.

=== PROJECT FILES ===
${projectScan}

=== MANDATORY REQUIREMENTS ===
1. ALWAYS cite actual file paths + function/class/variable names as evidence.
2. Do NOT write generic statements — if no evidence found, write "not found in codebase".
3. Analyze at BUSINESS DEPTH — explain what user problem each feature solves.
4. Prioritize analysis: test files > service layer > controller > model.
5. When you see magic numbers → explain their business meaning.`;

  const total = KB_STEPS.length + 1; // +1 for review-skills
  let completedSteps = 0;

  // ── Run KB steps in batches ────────────────────────────────────
  for (let batchIdx = 0; batchIdx < BATCHES.length; batchIdx++) {
    if (token.isCancellationRequested) {
      log('\n⚠  KB generation cancelled.');
      return;
    }

    const batch = BATCHES[batchIdx];
    const batchSteps = batch.map(i => KB_STEPS[i]).filter(Boolean);

    log(`\n${'═'.repeat(66)}`);
    log(`  📦 BATCH ${batchIdx + 1}/${BATCHES.length} — ${batchSteps.map(s => s.label.split(' — ')[0]).join(' · ')}`);
    log(`${'═'.repeat(66)}\n`);

    progress.report({
      message: `Batch ${batchIdx + 1}/${BATCHES.length}: ${batchSteps.length} steps in parallel...`,
      increment: Math.floor(85 / BATCHES.length),
    });

    // Run all steps in this batch in parallel
    const batchPromises = batchSteps.map(async (step) => {
      const isDeep = DEEP_ANALYSIS_STEPS.has(step.file);

      log(`   ├─ ${isDeep ? '🔬' : '📝'} ${step.label} ${isDeep ? '(multi-agent deep)' : '(single agent)'}`);

      let content: string;
      if (isDeep) {
        // Multi-agent deep analysis for critical business steps
        content = await deepAnalyzeStep(step, KB_SYSTEM, slices, model, token);

        // Fallback if multi-agent returned empty
        if (!content.trim()) {
          log(`   ⚠  Deep analysis failed for ${step.file} — fallback to single agent`);
          content = await callCopilot(model, KB_SYSTEM, step.prompt, token, step.label);
        }
      } else {
        // Standard single-agent for non-critical steps
        content = await callCopilot(model, KB_SYSTEM, step.prompt, token, step.label);
      }

      return { step, content };
    });

    // Limit concurrent promises within batch
    const results = await settledBatch(batchPromises, maxParallel);

    // Save results
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.content) {
        const { step, content } = result.value;
        const outPath = path.join(kbPath, step.file);
        fs.writeFileSync(outPath, content, 'utf-8');
        completedSteps++;
        log(`   └─ ✅ ${step.file} (${(content.length / 1024).toFixed(1)}KB)`);
      } else if (result.status === 'rejected') {
        log(`   └─ ❌ Failed: ${result.reason?.message ?? result.reason}`);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  // FINAL STEP — Review Skills (Universal Template + Section 14)
  // ══════════════════════════════════════════════════════════════
  if (!token.isCancellationRequested) {
    kbHeader(total, total, 'Review Skills (Universal + Project-Specific)');
    progress.report({ message: `KB ${total}/${total}: Review Skills...`, increment: 5 });

    const templatePath = path.join(extensionPath, 'resources', 'review-skills-universal.md');
    let universalTemplate = '';
    if (fs.existsSync(templatePath)) {
      universalTemplate = fs.readFileSync(templatePath, 'utf-8');
      log(`✅ Universal template loaded (${(universalTemplate.length / 1024).toFixed(1)}KB)`);
    }

    // Multi-agent for Section 14 — different agents find different types of rules
    const orchestrator = new AgentOrchestrator({ maxParallel: 3 });

    const section14Agents: SubAgent[] = [
      {
        id: 'naming-patterns',
        role: 'Naming & Pattern Analyzer',
        priority: 2,
        systemContext: KB_SYSTEM,
        prompt: `Find PROJECT-SPECIFIC rules for:\n\n### Project-Specific Naming Conventions\nCite real examples.\n\n### Mandatory Patterns & Conventions\nPatterns unique to THIS project.\n\n### Project-Specific Technologies / Libraries and Correct Usage\nHow are specific libraries used here?\n\nEvery rule must cite an actual file path and code example. If nothing found, write "(none found)".`,
      },
      {
        id: 'architecture-rules',
        role: 'Architecture Rule Analyzer',
        priority: 2,
        systemContext: KB_SYSTEM,
        prompt: `Find PROJECT-SPECIFIC rules for:\n\n### Project-Specific Architecture / Layer Rules\nWhat layer rules are unique to this project?\n\n### Anti-Patterns Banned in this Project\nWhat patterns should NEVER be used here? Infer from code review comments, linting rules, or consistent avoidance patterns.\n\nEvery rule must cite an actual file path and code example.`,
      },
      {
        id: 'business-rules-enforcer',
        role: 'Business Rule Enforcer',
        priority: 3,
        systemContext: `${KB_SYSTEM}\n\n=== FOCUS ON TEST FILES ===\n${slices.tests.slice(0, 40_000)}`,
        prompt: `Find PROJECT-SPECIFIC rules for:\n\n### Business Rules to Enforce in Every New Feature\nWhat business rules should EVERY new feature respect? Infer from:\n- Recurring validation patterns across multiple services\n- Guards/middleware applied to all routes\n- Common test assertions that verify invariants\n- Constants that define business limits\n\nEvery rule must cite an actual file path and code example. Severity: [CRITICAL], [MAJOR], or [MINOR].`,
      },
    ];

    const { merged: section14Content } = await orchestrator.runAndMerge(
      section14Agents,
      'Merge all project-specific rules into a single Section 14 document. Deduplicate. Keep the ### subsection headers. Every rule must have a code citation.',
      model, token, KB_SYSTEM,
    );

    let section14 = section14Content;
    if (!section14.trim()) {
      log(`⚠  Multi-agent Section 14 failed — fallback`);
      section14 = await callCopilot(model, KB_SYSTEM,
        'Find project-specific rules not covered by general review skills. Cite code examples.',
        token, 'Section 14 (fallback)');
    }

    // Merge universal template + Section 14
    let reviewSkillsContent: string;
    const PLACEHOLDER = '<!-- Placeholder — will be automatically updated by Auto Spec Kit final KB step -->';

    if (universalTemplate) {
      if (universalTemplate.includes(PLACEHOLDER)) {
        reviewSkillsContent = universalTemplate.replace(PLACEHOLDER, section14);
        log(`✅ Section 14 merged into Universal Template`);
      } else {
        reviewSkillsContent = universalTemplate + '\n\n' + section14;
        log(`⚠  Placeholder not found — Section 14 appended`);
      }
    } else {
      reviewSkillsContent =
        `# Review Skills — Project-Specific Rules\n\n` +
        `> ⚠️ Universal template not loaded.\n\n` +
        section14;
    }

    fs.writeFileSync(path.join(kbPath, 'review-skills.md'), reviewSkillsContent, 'utf-8');
    completedSteps++;
    log(`✅ Saved → ${kbRelPath}/review-skills.md (${(reviewSkillsContent.length / 1024).toFixed(1)}KB)`);
  }

  // ── Summary ────────────────────────────────────────────────────
  banner([
    '✅  KNOWLEDGE BASE GENERATION COMPLETE!',
    `${completedSteps}/${total} files · Multi-Agent Deep Analysis`,
  ]);
  log(`\n🌟 Most important files (generated with multi-agent deep analysis):`);
  log(`   → ${kbRelPath}/04-business-domain.md   — product brief, user roles, core features`);
  log(`   → ${kbRelPath}/05-domain-model.md      — entities, state machines, relationships`);
  log(`   → ${kbRelPath}/10-core-flows.md        — business flows end-to-end`);
  log(`   → ${kbRelPath}/13-business-rules.md    — all business rules & invariants`);
  log(`   → ${kbRelPath}/review-skills.md        — injected into every code review`);
  log(`\n💡 Next: Run a task with Ctrl+Shift+K to use the Knowledge Base.`);

  const rsPath = path.join(kbPath, 'review-skills.md');
  if (fs.existsSync(rsPath)) {
    const doc = await vscode.workspace.openTextDocument(rsPath);
    await vscode.window.showTextDocument(doc, { preview: false });
  }

  vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');

  const action = await vscode.window.showInformationMessage(
    `📚 KB generated! ${completedSteps} files (4 with deep multi-agent analysis)`,
    'Open KB Folder',
    'Run a task now'
  );
  if (action === 'Open KB Folder') {
    vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(kbPath));
  } else if (action === 'Run a task now') {
    vscode.commands.executeCommand('autoSpecKit.run');
  }
}

// ─── Utility: run promises with concurrency limit ─────────────────────────────

async function settledBatch<T>(
  promises: Promise<T>[],
  concurrency: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(promises.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < promises.length) {
      const idx = nextIndex++;
      try {
        const value = await promises[idx];
        results[idx] = { status: 'fulfilled', value };
      } catch (reason: any) {
        results[idx] = { status: 'rejected', reason };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, promises.length) },
    () => runNext(),
  );
  await Promise.all(workers);
  return results;
}
