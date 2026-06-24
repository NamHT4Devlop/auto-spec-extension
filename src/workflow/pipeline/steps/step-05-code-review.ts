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
import { saveFile, extractFiles, loadKbDocs } from '../../../utils/file-utils';
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

    // Documented architecture + conventions the change must conform to.
    const archGuardrails = loadKbDocs(
      ctx.workspaceRoot, ctx.kbRelPath,
      ['16-architecture-patterns.md', '12-conventions.md'], 14_000,
    );

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
        role: 'Architecture & Pattern Conformance Reviewer',
        priority: 3,
        systemContext: `You are a software architect enforcing the project's documented architecture and design patterns.\n\n${archGuardrails ? `=== DOCUMENTED ARCHITECTURE & PATTERNS (the change MUST conform) ===\n${archGuardrails}` : (ctx.kb ? `=== PROJECT CONVENTIONS ===\n${ctx.kb.slice(0, 10000)}` : '')}`,
        prompt: `\
${sharedCodeContext}

## YOUR FOCUS: ARCHITECTURE & PATTERN CONFORMANCE (DO NOT let the change break the design)
Check the generated code against the DOCUMENTED architecture & patterns above. Flag every deviation:

1. **Architecture Invariants** — Does the code violate any rule in "Architecture Invariants — DO NOT BREAK"? Quote the specific invariant it breaks.
2. **Pattern Conformance** — Does the new code follow the SAME design pattern as the module it lives in (e.g., Repository, Ports & Adapters, CQRS, Camel route)? Or did it introduce a foreign pattern?
3. **Layer / Dependency Rules** — Any forbidden dependency direction (e.g. controller → DB directly, domain → infrastructure, cross-module shortcut, circular dependency)?
4. **Boundary Violations** — Does it cross a module/bounded-context boundary in a way the docs forbid (should use a port/event/queue instead)?
5. **Extension Recipe** — If an Extension Recipe exists for this kind of change, does the code follow it? If not, what diverged?
6. **Consistency** — Naming, error-handling location, transaction boundaries, validation placement — match the documented conventions?

For each issue: severity (CRITICAL/MAJOR/MINOR), exact location, which documented rule/pattern is violated, the bad code, and the fixed code that conforms. If the code fully conforms, say so explicitly.`,
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
