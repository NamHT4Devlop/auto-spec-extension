/**
 * Step 05 — Code Review (Multi-Agent)
 *
 * Spawns 4 parallel reviewer agents:
 *   1. Security Reviewer       — injection, auth bypass, data exposure
 *   2. Architecture Reviewer   — patterns, coupling, layer violations
 *   3. Performance Reviewer    — N+1 queries, memory leaks, bottlenecks
 *   4. Business Consistency    — rules intact, state machines valid, no logic removed
 *
 * Merge agent produces final structured review with verdict and score.
 */

import { log } from '../../../logger';
import { callCopilot } from '../../../utils/copilot';
import { saveFile, extractFiles } from '../../../utils/file-utils';
import { loadGitContext, formatGitContextForPrompt } from '../../../utils/git-utils';
import { AgentOrchestrator, SubAgent, orchestratorConfigFor } from '../../../utils/agent-orchestrator';
import { PipelineContext, PipelineStep, StepResult } from '../types';

export class Step05CodeReview implements PipelineStep {
  readonly id = 'step-05';
  readonly name = 'Code Review (Multi-Agent)';
  readonly activeLabel = 'Reviewing code with specialist agents...';

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const planFinal = ctx.stepOutputs.get('step-03')?.output ?? '';
    const code = ctx.stepOutputs.get('step-04')?.output ?? '';

    // Load git context
    const filePaths = extractFiles(code).map(f => f.filePath);
    const gitCtx = loadGitContext(ctx.workspaceRoot, filePaths);
    const gitBlock = formatGitContextForPrompt(gitCtx);

    // Shared context for all reviewers
    const sharedCodeContext = `\
## REQUIREMENT: ${ctx.requirement}

## GENERATED CODE:
${code}

## GIT CONTEXT:
${gitBlock}`;

    const orchestrator = new AgentOrchestrator(orchestratorConfigFor(ctx, 'review', 4));

    const agents: SubAgent[] = [
      {
        id: 'security-reviewer',
        role: 'Security Reviewer',
        priority: 3,
        systemContext: `You are a security specialist reviewing code for vulnerabilities.\n\n${ctx.reviewSkills ? `=== REVIEW CHECKLIST ===\n${ctx.reviewSkills}` : ''}`,
        prompt: `\
${sharedCodeContext}

## YOUR FOCUS: SECURITY
Review this code exclusively for security issues:

1. **Input Validation** — Is all user input validated? SQL injection? XSS? Path traversal?
2. **Authentication** — Auth checks on every endpoint? Token validation correct?
3. **Authorization** — Can users access resources they shouldn't? IDOR vulnerabilities?
4. **Data Exposure** — Are sensitive fields (passwords, tokens, PII) exposed in responses/logs?
5. **Cryptography** — Weak hashing? Hardcoded secrets? Insecure random?
6. **Dependencies** — Known vulnerable patterns?

For each issue:
- Severity: CRITICAL / MAJOR / MINOR
- Exact code location
- The vulnerable code
- The fixed code (complete, no placeholders)`,
      },
      {
        id: 'architecture-reviewer',
        role: 'Architecture Reviewer',
        priority: 2,
        systemContext: `You are a software architect reviewing code for design quality.\n\n${ctx.kb ? `=== PROJECT CONVENTIONS ===\n${ctx.kb.slice(0, 10000)}` : ''}`,
        prompt: `\
${sharedCodeContext}

## YOUR FOCUS: ARCHITECTURE & CODE QUALITY
Review this code for design and quality:

1. **Layer Violations** — Does any code bypass the correct layer (e.g., controller calling DB directly)?
2. **Coupling** — Are modules properly decoupled? Any circular dependencies?
3. **Naming** — Do names follow project conventions? Are they descriptive?
4. **DRY** — Any duplicated logic that should be extracted?
5. **SOLID** — Single responsibility? Interface segregation? Dependency inversion?
6. **Error Handling** — Consistent with project patterns? No swallowed errors?
7. **Type Safety** — Any \`any\` types? Missing null checks? Unsafe casts?
8. **Consistency** — Does new code match existing project patterns exactly?

For each issue: severity, location, bad code, fixed code.`,
      },
      {
        id: 'performance-reviewer',
        role: 'Performance Reviewer',
        priority: 2,
        systemContext: 'You are a performance engineer reviewing code for efficiency.',
        prompt: `\
${sharedCodeContext}

## YOUR FOCUS: PERFORMANCE
Review this code for performance issues:

1. **N+1 Queries** — Loops that make DB/API calls per iteration?
2. **Missing Indexes** — New queries on unindexed columns?
3. **Memory Leaks** — Unbounded arrays, unclosed streams/connections?
4. **Unnecessary Work** — Redundant computations, unnecessary data loading?
5. **Async Patterns** — Blocking operations? Sequential calls that could be parallel?
6. **Caching** — Should any result be cached? Is an existing cache invalidated correctly?
7. **Pagination** — Large datasets loaded without pagination?

For each issue: severity, location, bad code, fixed code with explanation.`,
      },
      {
        id: 'business-reviewer',
        role: 'Business Consistency Reviewer',
        priority: 3,
        systemContext: `You are a business analyst verifying code against business rules.\n\n${ctx.kb ? `=== BUSINESS RULES & DOMAIN MODEL ===\n${ctx.kb.slice(0, 15000)}` : ''}`,
        prompt: `\
${sharedCodeContext}

## IMPLEMENTATION PLAN:
${planFinal.slice(0, 5000)}

## YOUR FOCUS: BUSINESS CONSISTENCY
Verify the code against business rules:

1. **Business Rules Intact** — Does the code violate any existing business rule in the KB?
2. **Logic Preserved** — Has any existing business logic been accidentally removed or overridden?
3. **State Machine Valid** — If entities change state, are transitions valid per the domain model?
4. **API Contract** — Are existing API contracts preserved? Any breaking changes?
5. **Acceptance Criteria** — Does the code satisfy ALL acceptance criteria from the plan?
6. **Missing Business Logic** — Are there business requirements from the plan that aren't implemented?

For each issue, explain the business impact (not just the technical problem).

## OUTPUT FORMAT:
| Check | Result | Detail |
|-------|--------|--------|
| Business rules intact | ✅/❌ | ... |
| No logic removed | ✅/❌ | ... |
| State machine valid | ✅/❌/N/A | ... |
| API contract preserved | ✅/❌/N/A | ... |
| All ACs implemented | ✅/❌ | ... |`,
      },
    ];

    const mergeInstruction = `\
You are the LEAD REVIEWER synthesizing findings from 4 specialist code reviewers.

## OUTPUT FORMAT — REQUIRED:

## 📋 SECTION COVERAGE
| Section | Status | Issues |
|---------|--------|--------|
| Security | ✅/⚠️/❌ | count |
| Architecture | | |
| Performance | | |
| Business Consistency | | |

## 🏢 BUSINESS CONSISTENCY
| Check | Result | Detail |
|-------|--------|--------|
(from Business Reviewer)

## 🐛 ISSUES (merged from all reviewers, deduplicated)
### Issue #N — [CRITICAL/MAJOR/MINOR] · \`file.ts\` · \`function()\`
> **Problem:** ...
> **Found by:** [which reviewer agent]

**❌ Bad code:**
\`\`\`
...
\`\`\`

**✅ Fixed code:**
\`\`\`
...
\`\`\`

## ✅ STRENGTHS (at least 3)

## 🎯 VERDICT: APPROVED / NEEDS_REVISION
## 📊 QUALITY SCORE: X/10 — reason`;

    const { merged, agentResults } = await orchestrator.runAndMerge(
      agents, mergeInstruction, ctx.model, ctx.token, ctx.systemPrompt,
    );

    // Fallback
    let review = merged;
    if (!review.trim()) {
      log(`⚠  Multi-agent review failed — falling back to single agent`);
      review = await callCopilot(ctx.model, ctx.systemPrompt,
        `Review this code for: security, architecture, performance, business consistency.\n\n${sharedCodeContext}`,
        ctx.token, 'Code Review (fallback)');
    }

    // Save
    saveFile(ctx.sessionDir, '04-code-review/review.md', `# Code Review\n\n${review}`);

    for (const result of agentResults) {
      if (result.success && result.output) {
        saveFile(ctx.sessionDir, `04-code-review/agent-${result.agentId}.md`,
          `# ${result.role}\n_Duration: ${(result.durationMs / 1000).toFixed(1)}s_\n\n${result.output}`);
      }
    }

    log(`✅ Review saved (${agentResults.filter(r => r.success).length}/${agentResults.length} reviewers)`);

    return {
      output: review,
      data: {
        agentResults: agentResults.map(r => ({ id: r.agentId, role: r.role, success: r.success })),
      },
    };
  }
}
