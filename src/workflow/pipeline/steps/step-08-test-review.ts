/**
 * Step 08 — Test Review (Multi-Agent)
 *
 * 2 parallel reviewers:
 *   1. Coverage Analyzer  — maps every function to its test, finds gaps
 *   2. Quality Reviewer   — assertion quality, flakiness, independence, naming
 *
 * Merge agent produces final verdict with coverage table.
 */

import { log } from '../../../logger';
import { callCopilot } from '../../../utils/copilot';
import { saveFile } from '../../../utils/file-utils';
import { AgentOrchestrator, SubAgent } from '../../../utils/agent-orchestrator';
import { PipelineContext, PipelineStep, StepResult } from '../types';

export class Step08TestReview implements PipelineStep {
  readonly id = 'step-08';
  readonly name = 'Test Review (Multi-Agent)';
  readonly activeLabel = 'Reviewing tests with specialist agents...';

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const codeFinal = ctx.stepOutputs.get('step-06')?.output
      ?? ctx.stepOutputs.get('step-04')?.output ?? '';
    const tests = ctx.stepOutputs.get('step-07')?.output ?? '';

    // Extract signatures for coverage mapping
    const signatures = codeFinal.split('\n')
      .filter(l => /function |const .* =|async |def |public |private |export /.test(l))
      .slice(0, 50).join('\n');

    const sharedContext = `\
## CODE BEING TESTED (signatures):
${signatures}

## FULL CODE:
${codeFinal.slice(0, 15000)}

## TEST SUITE TO REVIEW:
${tests}`;

    const orchestrator = new AgentOrchestrator({ maxParallel: 2 });

    const agents: SubAgent[] = [
      {
        id: 'coverage-analyzer',
        role: 'Coverage Analyzer',
        priority: 3,
        systemContext: 'You are a test coverage specialist. Your job is to map every testable function to its tests and find gaps.',
        prompt: `\
${sharedContext}

## YOUR TASK: COVERAGE ANALYSIS
For each public function/method/endpoint in the code:

### 📊 COVERAGE MAP
| Function / Endpoint | Has Unit Test? | Has Integration Test? | Has Edge Case Test? | Missing Scenarios |
|---------------------|---------------|----------------------|--------------------|--------------------|

### ❌ UNCOVERED CODE
List every function/branch that has NO test at all:
- \`functionName()\` — no test exists, should test: [scenarios]

### 📈 COVERAGE ESTIMATE
| Metric | Estimated % |
|--------|------------|
| Statement coverage | |
| Branch coverage | |
| Function coverage | |

### 🎯 VERDICT: APPROVED / NEEDS_MORE_TESTS`,
      },
      {
        id: 'quality-reviewer',
        role: 'Test Quality Reviewer',
        priority: 2,
        systemContext: 'You are a QA architect reviewing test code quality, not coverage (another agent handles that).',
        prompt: `\
${sharedContext}

## YOUR TASK: TEST QUALITY REVIEW
1. **Assertions** — Are assertions specific? (toBe vs toBeTruthy) Are expected values correct?
2. **Test Independence** — Can tests run in any order? Shared state?
3. **Naming** — Do test names describe behavior? "should [behavior] when [condition]"?
4. **Mocking** — Are mocks accurate? Do they reflect real behavior? Over-mocking?
5. **Flakiness Risk** — Timeouts, date-dependent, random data, async race conditions?
6. **DRY** — Redundant setup? Should use beforeEach/factories?
7. **Negative Tests** — Do error tests verify the exact error type/message?

### 🐛 ISSUES
For each issue:
- [CRITICAL/MAJOR/MINOR] · test name · problem → fix (show code)

### ✅ STRENGTHS (at least 2)
### 🎯 VERDICT: APPROVED / NEEDS_REVISION`,
      },
    ];

    const mergeInstruction = `\
Merge coverage analysis and quality review into one test review document.

## OUTPUT FORMAT:
### 📊 COVERAGE MAP
(from Coverage Analyzer — the full table)

### 📈 COVERAGE ESTIMATE
(from Coverage Analyzer)

### 🎯 TEST QUALITY
(from Quality Reviewer — summary)

### ❌ MISSING TEST CASES
(merged from both agents)

### 🐛 TEST ISSUES
(from Quality Reviewer, deduplicated)

### ✅ STRENGTHS

### 🎯 VERDICT: APPROVED / NEEDS_MORE_TESTS / NEEDS_REVISION`;

    const { merged, agentResults } = await orchestrator.runAndMerge(
      agents, mergeInstruction, ctx.model, ctx.token, ctx.systemPrompt,
    );

    let review = merged;
    if (!review.trim()) {
      log(`⚠  Multi-agent test review failed — fallback`);
      review = await callCopilot(ctx.model, ctx.systemPrompt,
        `Review this test suite for coverage and quality:\n${sharedContext}`,
        ctx.token, 'Test Review (fallback)');
    }

    saveFile(ctx.sessionDir, '06-test-review/review.md', `# Test Review\n\n${review}`);
    for (const r of agentResults) {
      if (r.success && r.output) {
        saveFile(ctx.sessionDir, `06-test-review/agent-${r.agentId}.md`, `# ${r.role}\n\n${r.output}`);
      }
    }

    log(`✅ Test review saved (${agentResults.filter(r => r.success).length}/2 reviewers)`);
    return { output: review };
  }
}
