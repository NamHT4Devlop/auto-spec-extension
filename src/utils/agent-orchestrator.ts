/**
 * agent-orchestrator.ts
 * Multi-agent orchestration for pipeline steps.
 *
 * Each pipeline step can define multiple "sub-agents" that run in parallel,
 * each analyzing a different aspect of the task. Results are merged by a
 * final merge agent into a single coherent output.
 *
 * Flow:
 *   1. Define sub-agents (role, system prompt, user prompt, context files)
 *   2. AgentOrchestrator runs them in parallel (with concurrency limit)
 *   3. Merge agent combines all sub-agent outputs
 *   4. Return final merged output
 */

import * as vscode from 'vscode';
import { log } from '../logger';
import { callCopilot } from './copilot';
import { estimateTokens, truncateToTokens } from './token-budget';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SubAgent {
  /** Unique id for this agent within the step */
  id: string;
  /** Human-readable role name (shown in logs) */
  role: string;
  /** System context specific to this agent's role */
  systemContext: string;
  /** The prompt/task for this agent */
  prompt: string;
  /** Max tokens for this agent's context (auto-truncated) */
  maxTokens?: number;
  /** Priority: higher = more important in merge (default: 1) */
  priority?: number;
}

export interface AgentResult {
  agentId: string;
  role: string;
  output: string;
  durationMs: number;
  success: boolean;
  error?: string;
}

export interface OrchestratorConfig {
  /** Max agents to run concurrently (default: 3) */
  maxParallel: number;
  /** Per-agent timeout in ms (default: 90_000) */
  agentTimeout: number;
  /** Merge strategy: 'ai' | 'concat' | 'structured' (default: 'ai') */
  mergeStrategy: 'ai' | 'concat' | 'structured';
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  maxParallel: 3,
  agentTimeout: 90_000,
  mergeStrategy: 'ai',
};

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export class AgentOrchestrator {
  private config: OrchestratorConfig;

  constructor(config?: Partial<OrchestratorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Run multiple sub-agents in parallel with concurrency control.
   * Returns results for all agents (including failed ones).
   */
  async runParallel(
    agents: SubAgent[],
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken,
  ): Promise<AgentResult[]> {
    log(`\n🤖 Orchestrator: launching ${agents.length} sub-agents (max ${this.config.maxParallel} parallel)`);

    const results: AgentResult[] = [];
    const queue = [...agents];

    // Process in batches of maxParallel
    while (queue.length > 0) {
      if (token.isCancellationRequested) { break; }

      const batch = queue.splice(0, this.config.maxParallel);

      log(`   ├─ Batch: ${batch.map(a => a.role).join(' | ')}`);

      const batchPromises = batch.map(agent => this.runSingleAgent(agent, model, token));
      const batchResults = await Promise.allSettled(batchPromises);

      for (let i = 0; i < batchResults.length; i++) {
        const settled = batchResults[i];
        if (settled.status === 'fulfilled') {
          results.push(settled.value);
        } else {
          results.push({
            agentId: batch[i].id,
            role: batch[i].role,
            output: '',
            durationMs: 0,
            success: false,
            error: settled.reason?.message ?? String(settled.reason),
          });
        }
      }
    }

    const succeeded = results.filter(r => r.success).length;
    const failed = results.length - succeeded;
    log(`   └─ Done: ${succeeded} succeeded, ${failed} failed`);

    return results;
  }

  /**
   * Run sub-agents in parallel, then merge their outputs using a merge agent.
   */
  async runAndMerge(
    agents: SubAgent[],
    mergeInstruction: string,
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken,
    systemContext: string = '',
  ): Promise<{ merged: string; agentResults: AgentResult[] }> {
    // Phase 1: Run sub-agents
    const agentResults = await this.runParallel(agents, model, token);

    if (token.isCancellationRequested) {
      return { merged: '', agentResults };
    }

    // Phase 2: Merge
    const successResults = agentResults
      .filter(r => r.success && r.output.trim())
      .sort((a, b) => {
        const pa = agents.find(ag => ag.id === a.agentId)?.priority ?? 1;
        const pb = agents.find(ag => ag.id === b.agentId)?.priority ?? 1;
        return pb - pa; // Higher priority first
      });

    if (successResults.length === 0) {
      log(`⚠  All agents failed — returning empty output`);
      return { merged: '', agentResults };
    }

    if (successResults.length === 1) {
      // Only one agent succeeded — no need for merge
      return { merged: successResults[0].output, agentResults };
    }

    const merged = await this.mergeResults(successResults, mergeInstruction, model, token, systemContext);
    return { merged, agentResults };
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private async runSingleAgent(
    agent: SubAgent,
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken,
  ): Promise<AgentResult> {
    const t0 = Date.now();

    try {
      // Truncate prompt if needed
      const prompt = agent.maxTokens
        ? truncateToTokens(agent.prompt, agent.maxTokens, agent.role)
        : agent.prompt;

      const output = await callCopilot(
        model,
        agent.systemContext,
        prompt,
        token,
        `🤖 ${agent.role}`,
      );

      return {
        agentId: agent.id,
        role: agent.role,
        output,
        durationMs: Date.now() - t0,
        success: true,
      };
    } catch (err: any) {
      log(`   ⚠  Agent "${agent.role}" failed: ${err?.message ?? err}`);
      return {
        agentId: agent.id,
        role: agent.role,
        output: '',
        durationMs: Date.now() - t0,
        success: false,
        error: err?.message ?? String(err),
      };
    }
  }

  private async mergeResults(
    results: AgentResult[],
    mergeInstruction: string,
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken,
    systemContext: string,
  ): Promise<string> {
    if (this.config.mergeStrategy === 'concat') {
      return results.map(r =>
        `## ${r.role}\n\n${r.output}`
      ).join('\n\n---\n\n');
    }

    if (this.config.mergeStrategy === 'structured') {
      return this.structuredMerge(results);
    }

    // AI merge (default)
    log(`\n🔀 Merge Agent: synthesizing ${results.length} agent outputs...`);

    const agentOutputs = results.map(r =>
      `## Agent: ${r.role} (${(r.durationMs / 1000).toFixed(1)}s)\n\n${r.output}`
    ).join('\n\n════════════════════════════════════════\n\n');

    const mergePrompt = `\
${mergeInstruction}

You are receiving outputs from ${results.length} specialized agents who analyzed the same task
from different perspectives. Your job is to:

1. SYNTHESIZE — combine all insights into one coherent document
2. DEDUPLICATE — remove redundant points (keep the most detailed version)
3. RESOLVE CONFLICTS — if agents disagree, note both perspectives and recommend the safer option
4. PRIORITIZE — put the most critical findings first
5. PRESERVE — do not discard any unique insight from any agent

=== AGENT OUTPUTS ===

${agentOutputs}

=== OUTPUT ===
Produce a single, well-structured Markdown document that captures ALL insights.`;

    return callCopilot(model, systemContext, mergePrompt, token, '🔀 Merge Agent');
  }

  private structuredMerge(results: AgentResult[]): string {
    const sections: string[] = [];
    for (const r of results) {
      sections.push(`## ${r.role}\n\n${r.output}`);
    }
    return sections.join('\n\n---\n\n');
  }
}
