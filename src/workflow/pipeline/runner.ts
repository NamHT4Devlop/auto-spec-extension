/**
 * PipelineRunner — orchestrates steps with checkpoint/resume.
 *
 * After each step completes:
 *   1. Saves the step output to stepOutputs map
 *   2. Persists session state to disk (JSON)
 *   3. Reports progress
 *
 * On resume:
 *   1. Loads session state from disk
 *   2. Skips already-completed steps
 *   3. Continues from the next pending step
 */
import * as fs from 'fs';
import * as path from 'path';
import { log, stepHeader } from '../../logger';
import { PipelineContext, PipelineStep, SessionState, StepResult } from './types';

export class PipelineRunner {
  private steps: PipelineStep[] = [];

  register(step: PipelineStep): this {
    this.steps.push(step);
    return this;
  }

  registerAll(steps: PipelineStep[]): this {
    this.steps.push(...steps);
    return this;
  }

  /**
   * Run the pipeline, optionally resuming from saved state.
   */
  async run(ctx: PipelineContext, resumeFromState?: SessionState): Promise<void> {
    const total = this.steps.length;
    const inc = Math.floor(100 / total);

    // Restore state if resuming
    if (resumeFromState) {
      log(`\n🔄 Resuming pipeline from checkpoint...`);
      log(`   Completed steps: ${resumeFromState.completedSteps.join(', ')}`);
      for (const [key, value] of Object.entries(resumeFromState.stepOutputs)) {
        ctx.stepOutputs.set(key, value);
      }
    }

    const completedSet = new Set(resumeFromState?.completedSteps ?? []);

    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];

      // Check cancellation
      if (ctx.token.isCancellationRequested) {
        log('\n⚠  Pipeline cancelled by user');
        this.saveState(ctx, completedSet);
        return;
      }

      // Skip completed steps on resume
      if (completedSet.has(step.id)) {
        log(`⏭  Skipping ${step.id} (already completed)`);
        ctx.progress.report({
          message: `Step ${i + 1}/${total}: ${step.name} (cached)`,
          increment: inc,
        });
        continue;
      }

      // Execute step
      stepHeader(i + 1, total, step.name);
      ctx.progress.report({
        message: `Step ${i + 1}/${total}: ${step.activeLabel}`,
        increment: inc,
      });

      try {
        const result = await step.execute(ctx);
        ctx.stepOutputs.set(step.id, result);
        completedSet.add(step.id);

        // Save checkpoint after each step
        this.saveState(ctx, completedSet);
      } catch (err: any) {
        if (ctx.token.isCancellationRequested) {
          log('\n⚠  Pipeline cancelled during step execution');
        } else {
          log(`\n❌ Step ${step.id} failed: ${err?.message ?? err}`);
          log(`   Pipeline state saved — you can resume later.`);
        }
        // Save state so we can resume
        this.saveState(ctx, completedSet);
        throw err;
      }
    }

    // Clean up state file on successful completion
    this.cleanupState(ctx);
  }

  /** Save current pipeline state to disk for resume capability */
  private saveState(ctx: PipelineContext, completedSteps: Set<string>): void {
    try {
      const state: SessionState = {
        requirement: ctx.requirement,
        sessionDir: ctx.sessionDir,
        completedSteps: Array.from(completedSteps),
        stepOutputs: Object.fromEntries(ctx.stepOutputs),
        timestamp: new Date().toISOString(),
      };
      const statePath = path.join(ctx.sessionDir, '.pipeline-state.json');
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
      log(`💾 Checkpoint saved (${completedSteps.size}/${this.steps.length} steps)`);
    } catch {
      // Non-critical — log but don't fail
      log(`⚠  Could not save checkpoint`);
    }
  }

  /** Remove state file after successful completion */
  private cleanupState(ctx: PipelineContext): void {
    try {
      const statePath = path.join(ctx.sessionDir, '.pipeline-state.json');
      if (fs.existsSync(statePath)) {
        fs.unlinkSync(statePath);
      }
    } catch {
      /* ignore */
    }
  }

  /** Load saved state from a session directory */
  static loadState(sessionDir: string): SessionState | undefined {
    try {
      const statePath = path.join(sessionDir, '.pipeline-state.json');
      if (!fs.existsSync(statePath)) {
        return undefined;
      }
      const raw = fs.readFileSync(statePath, 'utf-8');
      return JSON.parse(raw) as SessionState;
    } catch {
      return undefined;
    }
  }
}
