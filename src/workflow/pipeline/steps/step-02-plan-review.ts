/**
 * Step 02 — Plan Review (Multi-Agent)
 *
 * 2 parallel reviewer agents:
 *   1. Technical Feasibility — architecture, complexity, risk, missing steps
 *   2. Business Alignment   — ACs complete, business rules respected, flows correct
 *
 * Merge agent produces final verdict: APPROVED / NEEDS_REVISION.
 */

import { log } from '../../../logger';
import { callCopilot } from '../../../utils/copilot';
import { saveFile } from '../../../utils/file-utils';
import { AgentOrchestrator, SubAgent } from '../../../utils/agent-orchestrator';
import { PipelineContext, PipelineStep, StepResult } from '../types';

export class Step02PlanReview implements PipelineStep {
  readonly id = 'step-02';
  readonly name = 'Plan Review (Multi-Agent)';
  readonly activeLabel = 'Reviewing plan with specialist agents...';

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const plan = ctx.stepOutputs.get('step-01')?.output ?? '';

    const orchestrator = new AgentOrchestrator({ maxParallel: 2 });

    const agents: SubAgent[] = [
      {
        id: 'technical-reviewer',
        role: 'Technical Feasibility Reviewer',
        priority: 2,
        systemContext: `You are a senior software architect reviewing an implementation plan for technical feasibility.\n\n${ctx.kb ? `=== PROJECT ARCHITECTURE ===\n${ctx.kb.slice(0, 12000)}` : ''}`,
        prompt: `\
## REQUIREMENT
${ctx.requirement}

## PLAN TO REVIEW
${plan}

## YOUR FOCUS: TECHNICAL FEASIBILITY
1. **Architecture Consistency** — Does the plan follow the project's existing architecture? Any layer violations?
2. **Completeness** — Are ALL files that need changing listed? Any missing migration, config, or dependency update?
3. **Ordering** — Are implementation steps in correct dependency order?
4. **Complexity Assessment** — Is the complexity estimate realistic? Any underestimated tasks?
5. **Risk** — Breaking changes? Performance risks? Security concerns?
6. **Missing Steps** — Missing error handling? Missing validation? Missing rollback strategy?

## OUTPUT FORMAT
### ✅ APPROVED ITEMS (what's good)
### ⚠️ CONCERNS (potential issues)
### ❌ BLOCKERS (must fix before proceeding)
Each item: [CRITICAL/MAJOR/MINOR] description → recommended fix
### 🎯 VERDICT: APPROVED / NEEDS_REVISION`,
      },
      {
        id: 'business-reviewer',
        role: 'Business Alignment Reviewer',
        priority: 3,
        systemContext: `You are a business analyst reviewing a plan against business requirements.\n\n${ctx.kb ? `=== BUSINESS RULES & DOMAIN ===\n${ctx.kb.slice(0, 12000)}` : ''}`,
        prompt: `\
## REQUIREMENT
${ctx.requirement}

## PLAN TO REVIEW
${plan}

## YOUR FOCUS: BUSINESS ALIGNMENT
1. **Acceptance Criteria** — Are there ≥5 specific, measurable ACs? Do they fully cover the requirement?
2. **Business Rules** — Does the plan respect ALL existing business rules from the knowledge base?
3. **User Flows** — Are all affected user journeys identified? Happy path + error paths?
4. **Edge Cases** — Are business edge cases covered (not just technical)?
   - Permission/role scenarios
   - Concurrent operations
   - Data in unexpected states
   - Rollback scenarios
5. **Domain Model Impact** — Any entity changes that could break existing invariants?
6. **Backward Compatibility** — Will existing users/integrations be affected?

## OUTPUT FORMAT
### ✅ BUSINESS REQUIREMENTS MET
### ⚠️ GAPS IN BUSINESS COVERAGE
### ❌ BUSINESS RULE VIOLATIONS
Each item: description → impact → fix
### 🎯 VERDICT: APPROVED / NEEDS_REVISION`,
      },
    ];

    const mergeInstruction = `\
Merge the two review perspectives into a single plan review document.

## OUTPUT FORMAT — REQUIRED:
### ✅ COMPLETENESS — Does the plan fully cover the requirement?
### 🏗 ARCHITECTURE — Consistent with existing project patterns?
### 🏢 BUSINESS ALIGNMENT — All business rules respected? ACs complete?
### ⚠️ RISKS — Breaking changes, performance, security?

### 📝 ISSUES (merged, deduplicated):
- [CRITICAL] description → fix
- [MAJOR] description → fix
- [MINOR] description → fix

### 🎯 VERDICT: APPROVED / NEEDS_REVISION (+ one-line reason)`;

    const { merged, agentResults } = await orchestrator.runAndMerge(
      agents, mergeInstruction, ctx.model, ctx.token, ctx.systemPrompt,
    );

    let review = merged;
    if (!review.trim()) {
      log(`⚠  Multi-agent review failed — fallback`);
      review = await callCopilot(ctx.model, ctx.systemPrompt,
        `Review this implementation plan for: "${ctx.requirement}"\n\n${plan}`,
        ctx.token, 'Plan Review (fallback)');
    }

    saveFile(ctx.sessionDir, '02-plan-review/review.md', `# Plan Review\n\n${review}`);
    for (const r of agentResults) {
      if (r.success && r.output) {
        saveFile(ctx.sessionDir, `02-plan-review/agent-${r.agentId}.md`,
          `# ${r.role}\n\n${r.output}`);
      }
    }

    log(`✅ Plan review saved (${agentResults.filter(r => r.success).length}/2 reviewers)`);
    return { output: review };
  }
}
