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
import { callCopilot, resetTokenMeter, formatTokenUsage } from '../utils/copilot';
import {
  scanProject, scanModule, discoverModules, ScanOptions, ProjectModule,
  inventoryAllFiles, chunkFileInventory, scanFileEntries, FileEntry,
} from '../utils/project-scanner';
import { AgentOrchestrator, SubAgent } from '../utils/agent-orchestrator';
import { estimateTokens, truncateToTokens, modelInputBudget } from '../utils/token-budget';
import { ProjectProfileDetector } from '../utils/project-profile';
import { KB_STEPS, KbStep } from '../constants/kb-steps';

// ─── Critical steps that get multi-agent deep analysis ────────────────────────

const DEEP_ANALYSIS_STEPS = new Set([
  '04-business-domain.md',
  '05-domain-model.md',
  '10-core-flows.md',
  '13-business-rules.md',
  '16-architecture-patterns.md',
]);

// ─── Batch definitions (steps within a batch run in parallel) ─────────────────

const BATCHES: number[][] = [
  [0, 1, 2],       // Batch 1: structure, tech stack, entry points
  [3, 4, 5],       // Batch 2: business domain★, domain model★, modules
  [6, 7, 8],       // Batch 3: architecture, database, auth
  [9, 10, 11],     // Batch 4: core flows★, api docs, conventions
  [12, 13, 14],    // Batch 5: business rules★, integrations, errors
  [15],            // Batch 6: architecture & design patterns★ (guardrails)
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

    if (/\.test\.|\.spec\.|__tests__|test_|Test\.java|Tests\.java|IT\.java|Spec\.groovy|_test\.go|_test\.py/.test(lower)) {
      tests.push(block);
    } else if (/service|controller|handler|resolver|route|middleware|guard|interceptor|use-?case|command|query|processor|gateway|adapter|facade|delegate|listener|consumer|producer|endpoint|resource|rest|api|grpc/.test(lower)) {
      services.push(block);
    } else if (/entity|model|schema|migration|dto|interface|type|enum|prisma|\.sql|mapper|repository|dao|domain|pojo|vo|bo|\.properties|\.xml|flyway|liquibase/.test(lower)) {
      models.push(block);
    } else {
      // Config, util, and unclassified files go to services (general context)
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

// ─── Per-module deep analysis (map step for large projects) ───────────────────

async function analyzeModule(
  module: ProjectModule,
  moduleScan: string,
  kbSystemBase: string,
  model: vscode.LanguageModelChat,
  token: vscode.CancellationToken,
): Promise<string> {
  const orchestrator = new AgentOrchestrator({ maxParallel: 2, mergeStrategy: 'ai' });
  const moduleCtx = `=== MODULE: ${module.name} (path: ${module.relDir}, ${module.fileCount} files) ===\n${moduleScan.slice(0, 120_000)}`;

  const agents: SubAgent[] = [
    {
      id: 'flow-rule-cataloguer',
      role: 'Flow & Rule Cataloguer',
      priority: 3,
      systemContext: `${kbSystemBase}\n\n${moduleCtx}`,
      prompt: `For the module "${module.name}", produce a COMPLETE CATALOGUE (not a summary). Enumerate exhaustively and number each item.

### Business Flows
List EVERY business flow in this module. For each: entry point / trigger, step-by-step path (cite functions + files), state transitions, exit/outcome, error/rollback paths.

### Business Rules & Validations
List EVERY business rule, validation, constraint and invariant enforced here. For each: the rule, where enforced (file + function), and severity [CRITICAL]/[MAJOR]/[MINOR].

Cite real file paths and function names for every item. If a section has nothing, write "(none found)".`,
    },
    {
      id: 'domain-api',
      role: 'Domain & API Analyzer',
      priority: 2,
      systemContext: `${kbSystemBase}\n\n${moduleCtx}`,
      prompt: `For the module "${module.name}":

### Entities & Data Model
Entities/tables/DTOs with key fields, relationships, and state machines (status/state fields).

### API / Entry Points
Endpoints, message consumers/producers, scheduled jobs, CLI commands this module exposes.

### Dependencies
Which other modules/services this module depends on, and which depend on it.

Cite file paths for everything.`,
    },
  ];

  const mergeInstruction = `Produce the definitive Knowledge Base document for the module "${module.name}".
Merge the catalogue + domain analysis into ONE well-structured Markdown document with these sections in order:
**Overview**, **Business Flows**, **Business Rules**, **Entities & Data Model**, **API / Entry Points**, **Dependencies**.
Be EXHAUSTIVE — preserve every enumerated flow and rule from the agents (do not collapse the lists). Every claim must cite a file path. No generic filler.`;

  const { merged } = await orchestrator.runAndMerge(agents, mergeInstruction, model, token, kbSystemBase);
  return merged;
}

// ─── Chunk-level analysis (used when a module is too large for one AI call) ───

async function analyzeModuleChunk(
  module: ProjectModule,
  chunkScan: string,
  kbSystemBase: string,
  model: vscode.LanguageModelChat,
  token: vscode.CancellationToken,
  chunkIndex: number,
  totalChunks: number,
): Promise<string> {
  const system = `${kbSystemBase}\n\n=== MODULE: ${module.name} — CHUNK ${chunkIndex}/${totalChunks} ===\n${chunkScan}`;
  const prompt = `Analyze CHUNK ${chunkIndex} of ${totalChunks} for module "${module.name}".

For every file in this chunk, document:
### Business Flows
List every business operation or workflow found (entry point → steps → outcome). Cite function names and file paths.

### Business Rules & Validations
List every validation, guard, or constraint. File + function reference mandatory.

### Entities & Data
Key entities/DTOs/models with fields, state machines, relationships.

### API / Entry Points
Endpoints, consumers, scheduled jobs, CLI commands exposed in this chunk.

This is chunk ${chunkIndex} of ${totalChunks} — be exhaustive for these files only. Another pass will cover the remaining files.`;

  return callCopilot(model, system, prompt, token, `${module.name} chunk ${chunkIndex}/${totalChunks}`);
}

async function mergeChunkDocs(
  module: ProjectModule,
  chunkDocs: string[],
  kbSystemBase: string,
  model: vscode.LanguageModelChat,
  token: vscode.CancellationToken,
): Promise<string> {
  const combined = chunkDocs
    .map((doc, i) => `=== CHUNK ${i + 1} ANALYSIS ===\n${doc}`)
    .join('\n\n');
  const system = `${kbSystemBase}\n\n=== CHUNK ANALYSES TO MERGE ===\n${combined.slice(0, 100_000)}`;
  const prompt = `Produce the FINAL unified Knowledge Base document for module "${module.name}" by merging ${chunkDocs.length} chunk analyses.

Structure: **Overview** | **Business Flows** | **Business Rules** | **Entities & Data Model** | **API / Entry Points** | **Dependencies**

MERGE RULES:
1. DEDUPLICATE — merge flows/rules that appear in multiple chunks into one entry.
2. PRESERVE ALL — do NOT drop any flow, rule, or entity found across chunks.
3. EVIDENCE — every claim must cite file path + function/class name.
4. CROSS-REFERENCE — connect related flows and entities across chunks.
5. NO GENERIC STATEMENTS — if not evidenced in the code, omit it.`;

  return callCopilot(model, system, prompt, token, `${module.name} merge`);
}

// ─── Main exported function ───────────────────────────────────────────────────

export async function generateKnowledgeBase(
  workspaceRoot: string,
  model: vscode.LanguageModelChat,
  token: vscode.CancellationToken,
  progress: vscode.Progress<{ message?: string; increment?: number }>,
  extensionPath: string,
  scanOptions?: ScanOptions,
): Promise<void> {

  resetTokenMeter();
  const cfg = vscode.workspace.getConfiguration('autoSpecKit');
  const kbRelPath = cfg.get<string>('knowledgeBasePath', 'knowledge-base');
  const maxParallel = cfg.get<number>('agents.maxParallel', 3);
  const kbPath = path.join(workspaceRoot, kbRelPath);

  // Scan budget (KB) — higher than the old hard-coded caps for deeper coverage.
  const scanMaxFileBytes  = cfg.get<number>('scan.maxFileKB', 48) * 1024;
  const scanMaxTotalBytes = cfg.get<number>('scan.maxTotalKB', 900) * 1024;
  // Per-module KB generation (deep docs per business module).
  const perModuleEnabled  = cfg.get<boolean>('kb.perModule', true);
  // Default 100 — no artificial cap; safety valve for extremely large monorepos only.
  const maxModules        = cfg.get<number>('kb.maxModules', 100);
  const moduleScanBytes   = cfg.get<number>('kb.moduleMaxKB', 220) * 1024;

  // ── Determine scan mode ───────────────────────────────────────
  let effectiveScanOptions: ScanOptions = {
    maxFileBytes: scanMaxFileBytes,
    maxTotalBytes: scanMaxTotalBytes,
    ...(scanOptions ?? {}),
  };

  // ── Check existing KB ──────────────────────────────────────────
  if (fs.existsSync(kbPath)) {
    const existingFiles = fs.readdirSync(kbPath).filter(f => f.endsWith('.md'));
    if (existingFiles.length > 0) {
      const choice = await vscode.window.showQuickPick(
        [
          {
            label: '🧹 Fresh rebuild — source code only',
            description: 'Ignore ALL existing docs (README, copilot-instructions, docs/, etc.)',
            mode: 'source-only' as const,
          },
          {
            label: `🔄 Regenerate KB (include existing docs)`,
            description: `Overwrite ${existingFiles.length} KB files, but still read README/docs as context`,
            mode: 'include-docs' as const,
          },
          {
            label: '❌ Cancel — Keep existing KB',
            description: 'No changes',
            mode: 'cancel' as const,
          },
        ],
        {
          title: '⚠️ Knowledge Base already exists!',
          placeHolder: `${kbRelPath}/ has ${existingFiles.length} files. How do you want to regenerate?`,
        }
      );
      if (!choice || choice.mode === 'cancel') {
        log('⏭  KB generation cancelled.');
        return;
      }
      if (choice.mode === 'source-only') {
        effectiveScanOptions = { ...effectiveScanOptions, excludeDocs: true };
      }
    }
  } else {
    // No existing KB — still offer source-only if project has docs that might be stale
    const hasDocFiles = ['README.md', 'docs', '.github'].some(
      f => fs.existsSync(path.join(workspaceRoot, f))
    );
    if (hasDocFiles && !effectiveScanOptions.excludeDocs) {
      const choice = await vscode.window.showQuickPick(
        [
          {
            label: '📦 Include project docs (README, docs/, .github/)',
            description: 'Use existing documentation as additional context',
            sourceOnly: false,
          },
          {
            label: '🧹 Source code only — skip all docs',
            description: 'Recommended if docs are outdated or inaccurate',
            sourceOnly: true,
          },
        ],
        {
          title: 'Documentation files detected',
          placeHolder: 'Should the KB generator use existing documentation as context?',
        }
      );
      if (choice?.sourceOnly) {
        effectiveScanOptions = { ...effectiveScanOptions, excludeDocs: true };
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
  const modeLabel = effectiveScanOptions.excludeDocs ? 'source-only' : 'full (with docs)';
  log(`📂 Scanning project files... [${modeLabel}]`);
  progress.report({ message: `Scanning project (${modeLabel})...`, increment: 3 });
  const projectScan = scanProject(workspaceRoot, effectiveScanOptions);

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

  // ── Detect project profile for context-aware prompts ────────────
  const profileDetector = new ProjectProfileDetector(workspaceRoot);
  const profile = profileDetector.detect(true); // force-refresh for KB gen
  const profileSummary = ProjectProfileDetector.toPromptContext(profile);
  log(`📋 Project Profile: ${profileSummary}`);

  // Build technology-specific hints based on detected stack
  const techHints: string[] = [];
  const fw = profile.framework.toLowerCase();
  if (fw.includes('spring') || fw.includes('java') || fw.includes('kotlin')) {
    techHints.push('- Look for Spring annotations: @Service, @Controller, @Repository, @Component, @Bean, @Configuration, @Autowired, @Value');
    techHints.push('- Check application.properties / application.yml for config, datasource, messaging, cloud settings');
  }
  if (fw.includes('camel')) {
    techHints.push('- Analyze Apache Camel routes (RouteBuilder classes, from().to() DSL, XML <route> elements, error handlers, processors)');
  }
  if (fw.includes('mybatis')) {
    techHints.push('- Analyze MyBatis mapper XML files (SQL queries, resultMap, parameterType, dynamic SQL with <if>, <foreach>, <choose>)');
    techHints.push('- Link mapper XML to Java mapper interfaces (@Mapper, @Select, @Insert, @Update, @Delete annotations)');
  }
  if (fw.includes('flyway') || fw.includes('liquibase')) {
    techHints.push('- Analyze database migration files (Flyway V*.sql / Liquibase changelog) — they reveal schema evolution and business decisions');
  }
  if (fw.includes('aws')) {
    techHints.push('- Analyze AWS SDK usage: SQS queues, S3 buckets, Lambda functions, DynamoDB tables, SNS topics — document integration points');
  }
  if (fw.includes('jpa') || fw.includes('hibernate')) {
    techHints.push('- Analyze JPA entities: @Entity, @Table, @Column, @OneToMany, @ManyToOne, @JoinColumn — document relationships and constraints');
  }
  if (fw.includes('kafka')) {
    techHints.push('- Analyze Kafka producers/consumers: topics, consumer groups, message formats, error handling, dead-letter queues');
  }
  if (fw.includes('aws') || fw.includes('sqs') || fw.includes('sns')) {
    techHints.push('- Map AWS messaging/storage integration: SQS queues (producers/consumers, message schema, visibility timeout, DLQ), SNS topics, S3 buckets — document each integration point and its business trigger');
  }
  if (fw.includes('rails') || profile.language === 'ruby') {
    techHints.push('- Ruby on Rails: analyze app/models (ActiveRecord — validations, associations, callbacks, scopes = business rules), app/controllers (actions, strong params, before_actions), config/routes.rb (endpoints), db/migrate (schema evolution), and app/services / app/jobs for business logic. RSpec/Minitest specs reveal intent.');
  }
  const dbLower = (profile.database ?? '').toLowerCase();
  if (dbLower.includes('mysql') || dbLower.includes('postgres') || dbLower.includes('oracle') || dbLower.includes('sql server')) {
    techHints.push(`- Database is ${profile.database}: analyze schema/migrations (tables, columns, constraints, indexes, foreign keys) and link them to entities — DB constraints (unique, not-null, check) are enforced business rules`);
  }
  // Polyglot / monorepo: tell the analyst to treat each stack separately.
  if (profile.additionalStacks && profile.additionalStacks.length > 1) {
    techHints.push(`- POLYGLOT REPO — multiple stacks detected: ${profile.additionalStacks.join(', ')}. Analyze EACH stack/module on its own terms (don't assume one language); the per-module KB docs cover each module. Document how the stacks integrate (shared DB, queues/SQS, HTTP/gRPC, events).`);
  }
  if (profile.language === 'kotlin') {
    techHints.push('- This is a Kotlin project: look for data classes, sealed classes, coroutines, extension functions, companion objects');
  }
  if (profile.language === 'groovy' || fw.includes('spock')) {
    techHints.push('- Look for Groovy/Spock patterns: closures, DSL builders, Spock specifications (given/when/then blocks)');
  }

  const techHintBlock = techHints.length > 0
    ? `\n\n=== TECHNOLOGY-SPECIFIC ANALYSIS HINTS ===\n${techHints.join('\n')}`
    : '';

  // ── System context ─────────────────────────────────────────────
  // Base = role + stack + rules (no full source). Used for per-module analysis
  // where each agent receives only its module's source.
  const KB_SYSTEM_BASE = `\
You are a Principal Software Engineer and Business Analyst hired to deeply understand this codebase.

Your mission is NOT just to describe the code — but to understand WHY the code exists and WHAT PROBLEM IT SOLVES.

=== DETECTED PROJECT STACK ===
${profileSummary}

=== MANDATORY REQUIREMENTS ===
1. ALWAYS cite actual file paths + function/class/variable names as evidence.
2. Do NOT write generic statements — if no evidence found, write "not found in codebase".
3. Analyze at BUSINESS DEPTH — explain what user problem each feature solves.
4. Prioritize analysis: test files > service layer > controller > model.
5. When you see magic numbers → explain their business meaning.
6. Analyze ALL file types: source code, XML config, .properties, SQL migrations, YAML — each carries business context.
7. For XML-based configurations (Spring, MyBatis, Camel): these are AS IMPORTANT as code — document what they configure and why.${techHintBlock}`;

  // Full = base + project source, but CAPPED to the model's token budget so we never
  // exceed the input limit (the full scan also lives in _project-scan.md and per-module docs).
  const inputBudget = modelInputBudget(model as any);
  const cfgSystemScan = cfg.get<number>('kb.systemScanTokens', 70_000);
  // Reserve headroom for the per-step prompt + merge (agent outputs) + base context.
  const systemScanBudget = Math.max(8_000, Math.min(cfgSystemScan, inputBudget - 50_000));
  const scanForSystem = estimateTokens(projectScan) > systemScanBudget
    ? truncateToTokens(projectScan, systemScanBudget, 'project scan (see _project-scan.md & modules/ for full coverage)')
    : projectScan;
  log(`ℹ  Model input budget ~${inputBudget.toLocaleString()} tokens · system scan capped to ~${estimateTokens(scanForSystem).toLocaleString()} tokens`);
  const KB_SYSTEM = `${KB_SYSTEM_BASE}\n\n=== PROJECT FILES (most relevant; full scan in _project-scan.md & modules/) ===\n${scanForSystem}`;

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

  // ══════════════════════════════════════════════════════════════
  // COVERAGE REPORT — inventory every source file before module phase
  // so the user can see what exists vs what was analyzed.
  // ══════════════════════════════════════════════════════════════
  const allFileEntries = inventoryAllFiles(workspaceRoot, effectiveScanOptions);
  const totalFilesFound = allFileEntries.length;
  log(`\n📋 Full file inventory: ${totalFilesFound} source file(s) discovered (zero-skip mode)`);

  // ══════════════════════════════════════════════════════════════
  // MODULE PHASE — zero-skip: every module, every file, every chunk
  // ══════════════════════════════════════════════════════════════
  let moduleCount = 0;
  const analyzedRelPaths = new Set<string>();

  if (perModuleEnabled && !token.isCancellationRequested) {
    // No hard cap: process all modules the project has.
    // maxModules config (default 100) is a safety valve for very large repos.
    const modules = discoverModules(workspaceRoot, effectiveScanOptions).slice(0, maxModules);
    if (modules.length > 0) {
      const modulesDir = path.join(kbPath, 'modules');
      fs.mkdirSync(modulesDir, { recursive: true });

      log(`\n${'═'.repeat(66)}`);
      log(`  🧩 MODULE PHASE (zero-skip) — ${modules.length} module(s): ${modules.map(m => m.name).join(', ')}`);
      log(`${'═'.repeat(66)}\n`);
      progress.report({ message: `Deep-analyzing ${modules.length} modules (zero-skip)...`, increment: 5 });

      const moduleResults = await settledBatch(
        modules.map(async (mod) => {
          // ── Get complete file inventory for this module ──
          const modFileEntries = inventoryAllFiles(workspaceRoot, {
            ...effectiveScanOptions, subDir: mod.relDir,
          });
          const chunks = chunkFileInventory(modFileEntries, moduleScanBytes, scanMaxFileBytes);
          log(`   ├─ 🔬 ${mod.name} (${modFileEntries.length} files → ${chunks.length} chunk(s))`);

          let doc: string;
          if (chunks.length === 0) {
            // Module discovered but no readable files (e.g., all binary) — skip silently.
            return { mod, doc: '' };
          } else if (chunks.length === 1) {
            // Small module: single-pass analysis using existing analyzeModule function.
            const modScan = scanFileEntries(modFileEntries, scanMaxFileBytes);
            doc = await analyzeModule(mod, modScan, KB_SYSTEM_BASE, model, token);
          } else {
            // Large module: analyze each chunk separately, then merge results.
            log(`      ↳ large module — ${chunks.length} chunks to process sequentially`);
            const chunkDocs: string[] = [];
            for (let ci = 0; ci < chunks.length; ci++) {
              if (token.isCancellationRequested) { break; }
              const chunkScan = scanFileEntries(chunks[ci], scanMaxFileBytes);
              const chunkDoc = await analyzeModuleChunk(
                mod, chunkScan, KB_SYSTEM_BASE, model, token, ci + 1, chunks.length,
              );
              chunkDocs.push(chunkDoc);
              log(`      ↳ chunk ${ci + 1}/${chunks.length} done (${(chunkDoc.length / 1024).toFixed(1)}KB)`);
            }
            doc = chunkDocs.length === 1
              ? chunkDocs[0]
              : await mergeChunkDocs(mod, chunkDocs, KB_SYSTEM_BASE, model, token);
          }

          // Track which files were analyzed for coverage report.
          for (const e of modFileEntries) { analyzedRelPaths.add(e.relPath); }
          return { mod, doc };
        }),
        maxParallel,
      );

      const indexLines: string[] = [
        `# Modules Index`,
        `_Auto-generated by Auto Spec Kit — zero-skip per-module deep analysis_\n`,
        `| Module | Files | Chunks | Path |`,
        `|--------|-------|--------|------|`,
      ];
      for (const r of moduleResults) {
        if (r.status === 'fulfilled' && r.value.doc.trim()) {
          const { mod, doc } = r.value;
          const modFiles = inventoryAllFiles(workspaceRoot, { ...effectiveScanOptions, subDir: mod.relDir });
          const numChunks = chunkFileInventory(modFiles, moduleScanBytes, scanMaxFileBytes).length;
          const safe = mod.name.replace(/[^a-zA-Z0-9._-]/g, '-');
          const rel = `modules/${safe}.md`;
          fs.writeFileSync(
            path.join(kbPath, rel),
            `# Module: ${mod.name}\n_Path: \`${mod.relDir}\` · ${mod.fileCount} source file(s) · ${numChunks} chunk(s)_\n\n${doc}`,
            'utf-8',
          );
          indexLines.push(`| [${mod.name}](./${safe}.md) | ${mod.fileCount} | ${numChunks} | \`${mod.relDir}\` |`);
          moduleCount++;
          log(`   └─ ✅ ${rel} (${(doc.length / 1024).toFixed(1)}KB)`);
        } else if (r.status === 'rejected') {
          log(`   └─ ❌ module failed: ${r.reason?.message ?? r.reason}`);
        }
      }
      fs.writeFileSync(path.join(modulesDir, '_index.md'), indexLines.join('\n') + '\n', 'utf-8');
      completedSteps += moduleCount;
      log(`\n✅ Module docs: ${moduleCount} files in ${kbRelPath}/modules/`);
    } else {
      log('ℹ  No distinct modules detected — skipping module phase.');
    }
  }

  // ══════════════════════════════════════════════════════════════
  // COVERAGE REPORT — write _coverage-report.md
  // ══════════════════════════════════════════════════════════════
  const notAnalyzed = allFileEntries.filter(e => !analyzedRelPaths.has(e.relPath));
  const coveragePct = totalFilesFound > 0
    ? Math.round((analyzedRelPaths.size / totalFilesFound) * 100)
    : 100;

  const coverageLines = [
    `# Coverage Report`,
    `_Auto-generated by Auto Spec Kit — zero-skip KB generation_\n`,
    `**Total files discovered:** ${totalFilesFound}`,
    `**Files analyzed via modules:** ${analyzedRelPaths.size}`,
    `**Module coverage:** ${coveragePct}%`,
    `**Note:** All files are also covered by the global KB steps (01–16) via _project-scan.md.\n`,
  ];

  if (notAnalyzed.length > 0) {
    coverageLines.push(`## Files covered by global KB only (not in a module)`);
    coverageLines.push('These files were included in the global project scan and analyzed by all 16 KB steps,');
    coverageLines.push('but do not belong to a discovered module (e.g., root-level configs, shared utilities).\n');
    for (const e of notAnalyzed) {
      coverageLines.push(`- \`${e.relPath}\` (${(e.size / 1024).toFixed(1)}KB)`);
    }
  } else {
    coverageLines.push(`## ✅ Full module coverage — every file belongs to an analyzed module.`);
  }

  fs.writeFileSync(
    path.join(kbPath, '_coverage-report.md'),
    coverageLines.join('\n') + '\n',
    'utf-8',
  );
  log(`📊 Coverage report: ${coveragePct}% module coverage (${analyzedRelPaths.size}/${totalFilesFound} files)`);

  // ── Summary ────────────────────────────────────────────────────
  const kbTokenUsage = formatTokenUsage();
  log(`\n📊 Token usage (KB generation): ${kbTokenUsage}`);
  banner([
    '✅  KNOWLEDGE BASE GENERATION COMPLETE!',
    `${completedSteps} files · ${moduleCount} module docs · Multi-Agent Deep Analysis`,
    kbTokenUsage,
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
