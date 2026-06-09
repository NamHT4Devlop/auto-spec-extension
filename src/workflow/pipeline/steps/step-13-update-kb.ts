/**
 * Step 13 — Update Knowledge Base (Multi-Agent)
 *
 * 2 parallel delta analyzers:
 *   1. Technical Delta — new modules, APIs, patterns, schema changes
 *   2. Business Delta  — new business rules, flows, domain changes, invariants
 *
 * Merge agent produces targeted KB update patches per file.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { log } from '../../../logger';
import { callCopilot } from '../../../utils/copilot';
import { saveFile } from '../../../utils/file-utils';
import { AgentOrchestrator, SubAgent } from '../../../utils/agent-orchestrator';
import { PipelineContext, PipelineStep, StepResult } from '../types';

export class Step13UpdateKB implements PipelineStep {
  readonly id = 'step-13';
  readonly name = 'Update KB (Multi-Agent)';
  readonly activeLabel = 'Analyzing KB delta with agents...';

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const kbUpdateChoice = await vscode.window.showQuickPick(
      [
        { label: '⭐ Yes — Update KB with changes from this task', update: true },
        { label: '⏭  No — Skip (not recommended)', update: false },
      ],
      {
        title: 'Update Knowledge Base?',
        placeHolder: 'KB should be updated after every task to reflect the current business state',
      }
    );

    if (!kbUpdateChoice?.update) {
      log('⏭  KB update skipped');
      return { output: '(skipped)', data: { skipped: true } };
    }

    const planFinal = ctx.stepOutputs.get('step-03')?.output ?? '';
    const codeFinal = ctx.stepOutputs.get('step-06')?.output
      ?? ctx.stepOutputs.get('step-04')?.output ?? '';
    const codeReview = ctx.stepOutputs.get('step-05')?.output ?? '';

    const codeSummary = codeFinal.split('\n')
      .filter(l => /###\s*FILE:|function |class |interface |export |import /.test(l))
      .slice(0, 60).join('\n');

    const today = new Date().toISOString().slice(0, 10);

    const orchestrator = new AgentOrchestrator({ maxParallel: 2 });

    const agents: SubAgent[] = [
      {
        id: 'technical-delta',
        role: 'Technical Delta Analyzer',
        priority: 2,
        systemContext: `You are analyzing what TECHNICAL changes a completed task introduced to a codebase.\n\n${ctx.kb ? `=== CURRENT KB (technical sections) ===\n${ctx.kb.slice(0, 10000)}` : ''}`,
        prompt: `\
## TASK COMPLETED: ${ctx.requirement}

## CODE SUMMARY:
${codeSummary}

## PLAN:
${planFinal.slice(0, 3000)}

## TASK: Find TECHNICAL delta — what changed from previous state?

1. **New API Endpoints** — method, path, request/response (for 11-api-docs.md)
2. **New Modules / Files** — new folders or significant new files (for 06-modules.md)
3. **Schema Changes** — new tables, columns, indexes (for 08-database-schema.md)
4. **Architecture Changes** — new layers, patterns, integrations (for 07-architecture-diagram.md)
5. **New Conventions** — any new pattern introduced for the first time (for 12-conventions.md)
6. **New Review Rules** — lessons from code review that should be a permanent rule (for review-skills.md)

## OUTPUT FORMAT — for each KB file that needs updating:
### UPDATE: knowledge-base/[filename].md
\`\`\`
---
## Update: ${today} — Task: ${ctx.requirement.slice(0, 50)}

[concise new content only — do NOT repeat existing KB content]
\`\`\`

⚠️ Only output files that ACTUALLY changed. If nothing is new: "(no update needed)".`,
      },
      {
        id: 'business-delta',
        role: 'Business Delta Analyzer',
        priority: 3,
        systemContext: `You are analyzing what BUSINESS changes a completed task introduced.\n\n${ctx.kb ? `=== CURRENT KB (business sections) ===\n${ctx.kb.slice(0, 10000)}` : ''}`,
        prompt: `\
## TASK COMPLETED: ${ctx.requirement}

## CODE SUMMARY:
${codeSummary}

## CODE REVIEW FINDINGS:
${codeReview.slice(0, 2000)}

## TASK: Find BUSINESS delta — what changed from previous state?

1. **New Business Rules** — new validations, constraints, invariants (for 13-business-rules.md)
2. **New/Changed Flows** — new user journeys or modified existing flows (for 10-core-flows.md)
3. **Domain Model Changes** — new entities, new fields, new relationships (for 05-domain-model.md)
4. **New User Capabilities** — what can users do now that they couldn't before? (for 04-business-domain.md)
5. **Security Changes** — new auth rules, permission changes (for 09-auth-security.md)
6. **New Error Scenarios** — new error codes, failure modes (for 15-error-scenarios.md)

## OUTPUT FORMAT — same as technical agent:
### UPDATE: knowledge-base/[filename].md
\`\`\`
---
## Update: ${today} — Task: ${ctx.requirement.slice(0, 50)}

[concise new content only]
\`\`\`

⚠️ Only output files that ACTUALLY changed.`,
      },
    ];

    const mergeInstruction = `\
Merge technical and business KB deltas into a single set of KB update patches.

## RULES:
1. DEDUPLICATE — if both agents update the same KB file, merge their content under one ### UPDATE block
2. Keep the exact format: ### UPDATE: knowledge-base/filename.md followed by fenced code block
3. Order by filename
4. Do NOT include files where nothing changed
5. Each update block should be concise — delta only, no repetition of existing content`;

    const { merged, agentResults } = await orchestrator.runAndMerge(
      agents, mergeInstruction, ctx.model, ctx.token, ctx.systemPrompt,
    );

    let kbDelta = merged;
    if (!kbDelta.trim()) {
      log(`⚠  Multi-agent KB delta failed — fallback`);
      kbDelta = await callCopilot(ctx.model, ctx.systemPrompt,
        `Analyze what changed in the KB from task: ${ctx.requirement}\n\nCode:\n${codeSummary}`,
        ctx.token, 'KB Delta (fallback)');
    }

    saveFile(ctx.sessionDir, '09-kb-updates/kb-delta.md',
      `# KB Update Delta\n\n**Task:** ${ctx.requirement}\n**Date:** ${today}\n\n${kbDelta}`);

    // Parse and apply updates
    const kbUpdatePattern = /###\s*UPDATE:\s*([^\n]+)\n```[^\n]*\n([\s\S]*?)```/g;
    let kbMatch: RegExpExecArray | null;
    const updatedFiles: string[] = [];

    while ((kbMatch = kbUpdatePattern.exec(kbDelta)) !== null) {
      const kbFilePath = kbMatch[1].trim();
      const kbContent = kbMatch[2].trim();
      const fullPath = path.join(ctx.workspaceRoot, kbFilePath);

      if (fs.existsSync(fullPath) && kbContent && kbContent !== '(no update needed)') {
        fs.appendFileSync(fullPath, `\n\n${kbContent}\n`, 'utf-8');
        updatedFiles.push(kbFilePath);
        log(`✅ KB updated → ${kbFilePath}`);
      } else if (!fs.existsSync(fullPath)) {
        log(`⚠  KB file not found, skipping: ${kbFilePath}`);
      }
    }

    if (updatedFiles.length === 0) {
      log('ℹ  No KB files needed updating');
    } else {
      log(`✅ Updated ${updatedFiles.length} KB file(s): ${updatedFiles.join(', ')}`);
      vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
    }

    for (const r of agentResults) {
      if (r.success && r.output) {
        saveFile(ctx.sessionDir, `09-kb-updates/agent-${r.agentId}.md`, `# ${r.role}\n\n${r.output}`);
      }
    }

    return {
      output: kbDelta,
      data: { updatedFiles, skipped: false },
    };
  }
}
