/**
 * Step 12 — Evidence Report (Multi-Agent)
 *
 * 2 parallel agents:
 *   1. Technical Evidence — files changed, test results, code metrics
 *   2. Business Evidence  — ACs verification, business flow validation, risk assessment
 *
 * Merge agent produces the final evidence document.
 */

import { log } from '../../../logger';
import { callCopilot } from '../../../utils/copilot';
import { saveFile } from '../../../utils/file-utils';
import { AgentOrchestrator, SubAgent } from '../../../utils/agent-orchestrator';
import { PipelineContext, PipelineStep, StepResult } from '../types';
import { TestResult } from '../../../types';

export class Step12Evidence implements PipelineStep {
  readonly id = 'step-12';
  readonly name = 'Evidence Report (Multi-Agent)';
  readonly activeLabel = 'Generating evidence report...';

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const planFinal = ctx.stepOutputs.get('step-03')?.output ?? '';
    const codeFinal = ctx.stepOutputs.get('step-06')?.output
      ?? ctx.stepOutputs.get('step-04')?.output ?? '';
    const codeReview = ctx.stepOutputs.get('step-05')?.output ?? '';
    const testsFinal = ctx.stepOutputs.get('step-09')?.output
      ?? ctx.stepOutputs.get('step-07')?.output ?? '';
    const testResultData = ctx.stepOutputs.get('step-11')?.data;
    const testResult = testResultData?.testResult as TestResult | undefined;

    const allFilesData = ctx.stepOutputs.get('step-10')?.data;
    const filesList = allFilesData?.allFiles
      ? (allFilesData.allFiles as Array<{ filePath: string }>)
          .map(f => `- \`${f.filePath}\``).join('\n')
      : '(no files extracted)';

    const testSummary = !testResult || testResult.skipped
      ? 'Tests not executed (no testCommand configured).'
      : `Command: ${testResult.command}\nResult: ${testResult.passed ? 'PASSED' : 'FAILED'}\nDuration: ${(testResult.durationMs / 1000).toFixed(1)}s\nCoverage: ${testResult.coverage !== null ? testResult.coverage + '%' : 'N/A'}\n\nOutput (last 2000 chars):\n${testResult.output.slice(-2000)}`;

    const orchestrator = new AgentOrchestrator({ maxParallel: 2 });

    const agents: SubAgent[] = [
      {
        id: 'technical-evidence',
        role: 'Technical Evidence Writer',
        priority: 2,
        systemContext: 'You are a technical writer documenting implementation evidence.',
        prompt: `\
## REQUIREMENT: ${ctx.requirement}

## FILES GENERATED:
${filesList}

## CODE REVIEW SUMMARY:
${codeReview.slice(0, 3000)}

## TEST RESULTS:
${testSummary}

## TASK: Write the TECHNICAL section of the evidence report:
1. **Implementation Summary** — What was built, which files, which patterns used
2. **Files Changed** — Table: file path, type (new/modified), description
3. **Test Results** — Pass/fail, coverage, duration, key failures if any
4. **Code Quality** — Score from review, critical issues found/fixed
5. **Technical Decisions** — Any notable choices made during implementation
6. **Dependencies** — New dependencies added, version compatibility`,
      },
      {
        id: 'business-evidence',
        role: 'Business Evidence Writer',
        priority: 3,
        systemContext: `You are a business analyst verifying that the implementation meets business requirements.\n\n${ctx.kb ? `=== BUSINESS RULES ===\n${ctx.kb.slice(0, 8000)}` : ''}`,
        prompt: `\
## REQUIREMENT: ${ctx.requirement}

## IMPLEMENTATION PLAN:
${planFinal.slice(0, 4000)}

## CODE GENERATED (summary):
${codeFinal.split('\n').filter(l => /###\s*FILE:|function |class |export /.test(l)).slice(0, 30).join('\n')}

## TASK: Write the BUSINESS section of the evidence report:
1. **Acceptance Criteria Verification** — Table:
   | AC | Status (✅/❌/⚠️) | Evidence |
   Where Evidence = which file/function proves this AC is met

2. **Business Flow Validation** — For each affected flow:
   - Flow name → tested? → working as expected?

3. **Business Rules Compliance** — Any KB business rule affected by this change?
   Did the implementation respect all rules?

4. **Risk Assessment** — Remaining risks after implementation:
   | Risk | Likelihood | Impact | Mitigated? |

5. **Known Limitations** — What is NOT covered by this implementation
6. **Recommended Follow-up** — Next steps for the team`,
      },
    ];

    const now = new Date().toLocaleString('en-US');
    const status = !testResult || testResult.skipped ? '⏭ SKIPPED'
      : testResult.passed ? '✅ PASSED' : '❌ FAILED';
    const covStr = testResult?.coverage !== null && testResult?.coverage !== undefined
      ? `${testResult.coverage}%` : 'N/A';

    const mergeInstruction = `\
Merge technical and business evidence into ONE professional evidence report.

## HEADER (include exactly):
# 📸 Evidence Report
| Field | Value |
|-------|-------|
| **Requirement** | ${ctx.requirement} |
| **Session** | ${ctx.sessionDir.split('/').pop()} |
| **Generated** | ${now} |
| **Test Status** | ${status} |
| **Coverage** | ${covStr} |

Then merge both agents' outputs into these sections:
## 1. Implementation Summary
## 2. Files Changed (table)
## 3. Acceptance Criteria Verification (table with evidence)
## 4. Business Flow Validation
## 5. Test Results
## 6. Code Quality Score
## 7. Risk Assessment
## 8. Known Limitations & Next Steps`;

    const { merged, agentResults } = await orchestrator.runAndMerge(
      agents, mergeInstruction, ctx.model, ctx.token, ctx.systemPrompt,
    );

    let evidence = merged;
    if (!evidence.trim()) {
      log(`⚠  Multi-agent evidence failed — fallback`);
      evidence = `# Evidence Report\n\n**Requirement:** ${ctx.requirement}\n**Status:** ${status}\n**Coverage:** ${covStr}\n\n## Files\n${filesList}\n\n## Test Results\n${testSummary}`;
    }

    saveFile(ctx.sessionDir, '07-evidence/EVIDENCE.md', evidence);

    // Save test output separately
    if (testResult?.output) {
      saveFile(ctx.sessionDir, '07-evidence/test-output.txt', testResult.output);
    }

    // Session README
    saveFile(ctx.sessionDir, 'README.md', `# Session: ${ctx.sessionDir.split('/').pop()}\n\n| | |\n|--|--|\n| **Requirement** | ${ctx.requirement} |\n| **Date** | ${now} |\n| **Status** | ${status} |\n| **Coverage** | ${covStr} |\n\n## Quick Links\n- [Plan](01-plan/plan.md)\n- [Code](03-code/code-raw.md)\n- [Tests](05-tests/tests-raw.md)\n- [Evidence](07-evidence/EVIDENCE.md)\n`);

    for (const r of agentResults) {
      if (r.success && r.output) {
        saveFile(ctx.sessionDir, `07-evidence/agent-${r.agentId}.md`, `# ${r.role}\n\n${r.output}`);
      }
    }

    log(`✅ Evidence report saved (${agentResults.filter(r => r.success).length}/2 agents)`);
    return { output: evidence };
  }
}
