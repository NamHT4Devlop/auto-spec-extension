/**
 * Step 07 — Write Tests (Multi-Agent)
 *
 * 3 parallel test writers:
 *   1. Unit Test Writer       — per-function mocks, isolate each unit
 *   2. Integration Test Writer — API endpoints, service composition, DB
 *   3. Edge Case & Security   — boundary values, error states, auth bypass, invalid input
 *
 * Merge agent combines into a deduplicated, complete test suite.
 */

import { log } from '../../../logger';
import { callCopilot } from '../../../utils/copilot';
import { saveFile } from '../../../utils/file-utils';
import { AgentOrchestrator, SubAgent } from '../../../utils/agent-orchestrator';
import { PipelineContext, PipelineStep, StepResult } from '../types';

export class Step07WriteTests implements PipelineStep {
  readonly id = 'step-07';
  readonly name = 'Write Tests (Multi-Agent)';
  readonly activeLabel = 'Generating tests with parallel agents...';

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const planFinal = ctx.stepOutputs.get('step-03')?.output ?? '';
    const codeFinal = ctx.stepOutputs.get('step-06')?.output
      ?? ctx.stepOutputs.get('step-04')?.output ?? '';

    // Extract function/method signatures for test planning
    const signatures = codeFinal.split('\n')
      .filter(l => /function |const .* =|async |def |public |private |export /.test(l))
      .slice(0, 50)
      .join('\n');

    const sharedContext = `\
## REQUIREMENT
${ctx.requirement}

## ACCEPTANCE CRITERIA
${planFinal.match(/Acceptance Criteria[\s\S]*?(?=###|$)/i)?.[0] ?? planFinal.slice(0, 3000)}

## CODE TO TEST
${codeFinal}

## FUNCTION SIGNATURES
${signatures}

## TEST FRAMEWORK
Language: ${ctx.lang}
Format each test file as: ### FILE: <path>`;

    const orchestrator = new AgentOrchestrator({ maxParallel: 3 });

    const agents: SubAgent[] = [
      {
        id: 'unit-test-writer',
        role: 'Unit Test Writer',
        priority: 3,
        systemContext: `You are a test engineer writing focused unit tests. Mock all dependencies. Each test should test ONE behavior.`,
        prompt: `\
${sharedContext}

## YOUR TASK: UNIT TESTS
Write unit tests for EVERY public function/method:

1. **Isolate** — Mock all dependencies (DB, external services, other modules)
2. **Cover** — For each function:
   - Happy path (correct input → correct output)
   - Return value verification
   - Side effects verification (was the right method called?)
3. **Name pattern**: "should [expected behavior] when [condition]"
4. **Aim for 100% function coverage**

Do NOT write integration tests or API tests — the other agents handle those.`,
      },
      {
        id: 'integration-test-writer',
        role: 'Integration Test Writer',
        priority: 2,
        systemContext: `You are a test engineer writing integration tests that verify components work together correctly.`,
        prompt: `\
${sharedContext}

## YOUR TASK: INTEGRATION TESTS
Write integration tests for cross-component flows:

1. **API Endpoint Tests** — Full request → response cycle for each endpoint
   - Correct HTTP method, path, headers
   - Request validation (400 on bad input)
   - Auth checks (401/403)
   - Success response shape
2. **Service Composition** — Tests where Service A calls Service B
3. **Database Integration** — If applicable, test actual DB queries (using test DB or in-memory)
4. **Flow Tests** — Test complete business flows end-to-end

Do NOT write unit tests or edge case tests — other agents handle those.`,
      },
      {
        id: 'edge-case-writer',
        role: 'Edge Case & Security Test Writer',
        priority: 3,
        systemContext: `You are a QA engineer specialized in finding bugs through edge cases, boundary values, and security testing.`,
        prompt: `\
${sharedContext}

## YOUR TASK: EDGE CASES & SECURITY TESTS
Write tests for scenarios that commonly cause bugs:

1. **Boundary Values** — Min/max values, empty strings, zero, negative numbers, very long strings
2. **Null/Undefined** — What happens with missing optional fields? null values?
3. **Concurrent Operations** — Race conditions, duplicate submissions
4. **Error Propagation** — Does the error bubble correctly? Right error code/message?
5. **Permission Bypass** — Can a lower-role user access higher-role endpoints?
6. **State Machine Violations** — Invalid state transitions (if applicable)
7. **Malicious Input** — SQL injection attempts, XSS payloads, oversized payloads

Each test: describe the edge case in the test name.
Do NOT write happy-path unit tests — other agents handle those.`,
      },
    ];

    const mergeInstruction = `\
Merge test outputs from 3 specialized test writers into ONE complete test suite.

## RULES:
1. **Deduplicate** — If multiple agents test the same scenario, keep the most thorough version
2. **Organize** — Group tests logically by file (one describe block per module/service)
3. **Keep ### FILE: format** — Each test file must have the ### FILE: prefix
4. **No conflicts** — Ensure test names don't collide
5. **Coverage table** — Start with a test case coverage table:

| Function/Endpoint | Unit | Integration | Edge Case | Total |
|-------------------|------|-------------|-----------|-------|

Then output all test files.`;

    const { merged, agentResults } = await orchestrator.runAndMerge(
      agents, mergeInstruction, ctx.model, ctx.token, ctx.systemPrompt,
    );

    let tests = merged;
    if (!tests.trim()) {
      log(`⚠  Multi-agent tests failed — fallback`);
      tests = await callCopilot(ctx.model, ctx.systemPrompt,
        `Write comprehensive tests for:\n${sharedContext}`,
        ctx.token, 'Write Tests (fallback)');
    }

    saveFile(ctx.sessionDir, '05-tests/tests-raw.md', tests);
    for (const r of agentResults) {
      if (r.success && r.output) {
        saveFile(ctx.sessionDir, `05-tests/agent-${r.agentId}.md`, r.output);
      }
    }

    log(`✅ Tests saved (${agentResults.filter(r => r.success).length}/3 writers)`);
    return { output: tests };
  }
}
