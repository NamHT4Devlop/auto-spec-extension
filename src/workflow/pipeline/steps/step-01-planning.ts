/**
 * Step 01 — Planning (Multi-Agent)
 *
 * Spawns 3 parallel sub-agents:
 *   1. Codebase Analyzer — reads relevant source, understands current implementation
 *   2. Impact Detector   — finds old flows affected, breaking changes, risks
 *   3. Business Flow Tracer — maps existing vs new business flows, state machines, rules
 *
 * A merge agent combines all findings into a comprehensive implementation plan.
 * Falls back to single-agent mode if multi-agent is disabled or all agents fail.
 */

import { log } from '../../../logger';
import { callCopilot } from '../../../utils/copilot';
import { saveFile } from '../../../utils/file-utils';
import { AgentOrchestrator, SubAgent, orchestratorConfigFor } from '../../../utils/agent-orchestrator';
import { SmartContextLoader } from '../../../utils/smart-context';
import { PipelineContext, PipelineStep, StepResult } from '../types';

export class Step01Planning implements PipelineStep {
  readonly id = 'step-01';
  readonly name = 'Planning (Multi-Agent)';
  readonly activeLabel = 'Analyzing codebase with sub-agents...';

  async execute(ctx: PipelineContext): Promise<StepResult> {
    // ── Phase 1: Smart Context Discovery ─────────────────────────
    const loader = new SmartContextLoader();

    // Token optimization: 'minimal' skips the File Discovery model call and loads
    // only lightweight convention context; 'full' loads all KB topics.
    let files: string[] = [];
    let kbTopics: string[] = [];
    if (ctx.contextStrategy === 'minimal') {
      kbTopics = ['conventions'];
      log(`ℹ  Context strategy 'minimal' — skipping file discovery to save tokens`);
    } else {
      ({ files, kbTopics } = await loader.discoverRelevantContext(
        ctx.requirement, ctx.workspaceRoot, ctx.kbRelPath, ctx.model, ctx.token,
      ));
    }

    const smartCtx = loader.loadContext(
      ctx.workspaceRoot, ctx.kbRelPath, files, kbTopics,
    );

    // ── Phase 2: Parallel Sub-Agents ─────────────────────────────
    const orchestrator = new AgentOrchestrator(orchestratorConfigFor(ctx, 'generative', 3));

    const codebaseContext = loader.buildAgentContext(
      smartCtx.chunks, ['source', 'config'], undefined, 25_000,
    );
    const businessContext = loader.buildAgentContext(
      smartCtx.chunks, ['kb'], ['business-rules', 'domain'], 25_000,
    );
    const architectureContext = loader.buildAgentContext(
      smartCtx.chunks, ['kb', 'source'], ['architecture', 'modules', 'api'], 25_000,
    );

    const agents: SubAgent[] = [
      {
        id: 'codebase-analyzer',
        role: 'Codebase Analyzer',
        priority: 2,
        systemContext: `You are a senior engineer analyzing existing source code to prepare for a new implementation.\n\n${codebaseContext}`,
        prompt: `\
## REQUIREMENT
${ctx.requirement}

## TASK
Analyze the existing codebase related to this requirement:

1. **Existing Implementation** — What code already exists that is related? List files, functions, classes.
2. **Patterns in Use** — What architecture patterns, naming conventions, folder structure does this project follow?
3. **Reusable Components** — What existing utilities, services, or modules can be reused?
4. **Dependencies** — What existing code will the new implementation depend on? What import paths?
5. **Potential Conflicts** — What existing code might conflict with or need modification?

Be specific — cite actual file paths and function names.`,
      },
      {
        id: 'impact-detector',
        role: 'Impact Detector',
        priority: 3,
        systemContext: `You are a QA architect identifying impact and risks for a code change.\n\n${architectureContext}`,
        prompt: `\
## REQUIREMENT
${ctx.requirement}

## TASK
Perform an impact analysis:

1. **Files That Must Change** — List every file that needs modification (not just new files).
2. **API Contract Changes** — Will any existing API endpoint's request/response shape change?
3. **Database Impact** — Any schema changes needed? Migration required?
4. **Breaking Changes** — Will this change break any existing consumer (frontend, mobile, other service)?
5. **Side Effects** — What existing flows will behave differently after this change?
6. **Risk Matrix**:
   | Risk | Likelihood | Impact | Mitigation |
   |------|-----------|--------|------------|

Be conservative — flag anything uncertain as a risk.`,
      },
      {
        id: 'business-flow-tracer',
        role: 'Business Flow Tracer',
        priority: 3,
        systemContext: `You are a business analyst tracing business flows through code.\n\n${businessContext}`,
        prompt: `\
## REQUIREMENT
${ctx.requirement}

## TASK
Map how this requirement interacts with existing business flows:

1. **Existing Flows Affected** — Which current business flows will this change touch? Trace each flow end-to-end.
2. **New Flow Definition** — Define the new business flow step by step:
   - Entry point (who triggers it, how?)
   - Each processing step (which service/function handles it)
   - State transitions (if any entity changes state)
   - Exit points (what is the final result/response)
3. **Business Rules** — What business rules from the knowledge base apply to this requirement?
   Which rules must the new code enforce?
4. **State Machine Impact** — If entities have state machines, how does this change affect valid transitions?
5. **Edge Cases** — Business edge cases to handle (not just technical edge cases):
   - What if the user has no permission?
   - What if the data is in an unexpected state?
   - What about concurrent operations?
   - What about rollback scenarios?`,
      },
    ];

    const mergeInstruction = `\
You are creating a COMPREHENSIVE IMPLEMENTATION PLAN by merging insights from 3 specialist agents.

## REQUIREMENT: ${ctx.requirement}

The output plan must include ALL of the following sections:

### 1. REQUIREMENT ANALYSIS
- Scope: what to do / what NOT to do
- Acceptance Criteria (≥5, specific and measurable)
- Edge cases (from Business Flow Tracer)

### 2. IMPACT ANALYSIS (from Impact Detector)
- Files to modify, breaking changes, risks

### 3. BUSINESS FLOW MAPPING (from Business Flow Tracer)
- Existing flows affected (before/after comparison)
- New flow definition (step-by-step)
- State machine changes

### 4. TECHNICAL DESIGN (from Codebase Analyzer)
- Modules/layers affected
- Files to CREATE (full paths following existing patterns)
- Files to MODIFY (full paths + specific changes)
- Reusable components to leverage

### 5. IMPLEMENTATION STEPS (ordered by dependency)
[ ] Step 1: ...
[ ] Step 2: ...

### 6. RISK ASSESSMENT (from Impact Detector)
Risk matrix with mitigations

### 7. ESTIMATE — Complexity: Simple/Medium/Complex | Time: X hours

⚠️ Do NOT generate code. Plan only.`;

    const { merged, agentResults } = await orchestrator.runAndMerge(
      agents, mergeInstruction, ctx.model, ctx.token, ctx.systemPrompt,
    );

    // ── Fallback: single-agent if all failed ─────────────────────
    let plan = merged;
    if (!plan.trim()) {
      log(`⚠  Multi-agent planning failed — falling back to single agent`);
      plan = await callCopilot(ctx.model, ctx.systemPrompt, `\
Create a detailed implementation plan for: ${ctx.requirement}

Include: requirement analysis, technical design, implementation steps, risks.
⚠️ Do NOT generate code.`, ctx.token, 'Planning (fallback)');
    }

    // ── Save outputs ─────────────────────────────────────────────
    saveFile(ctx.sessionDir, '01-plan/plan.md',
      `# Implementation Plan\n\n**Requirement:** ${ctx.requirement}\n\n${plan}`);

    // Save individual agent outputs for transparency
    for (const result of agentResults) {
      if (result.success && result.output) {
        saveFile(ctx.sessionDir, `01-plan/agent-${result.agentId}.md`,
          `# Agent: ${result.role}\n_Duration: ${(result.durationMs / 1000).toFixed(1)}s_\n\n${result.output}`);
      }
    }

    log(`✅ Plan saved to 01-plan/ (${agentResults.filter(r => r.success).length}/${agentResults.length} agents succeeded)`);

    return {
      output: plan,
      data: {
        relevantFiles: files,
        relevantKBTopics: kbTopics,
        agentResults: agentResults.map(r => ({ id: r.agentId, role: r.role, success: r.success, durationMs: r.durationMs })),
      },
    };
  }
}
