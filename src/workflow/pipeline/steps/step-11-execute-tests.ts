import { promisify } from 'util';
import { exec } from 'child_process';
import * as path from 'path';
import { log } from '../../../logger';
import { parseCoverage } from '../../../utils/coverage';
import { PipelineContext, PipelineStep, StepResult } from '../types';
import { TestResult } from '../../../types';

const execAsync = promisify(exec);

export class Step11ExecuteTests implements PipelineStep {
  readonly id = 'step-11';
  readonly name = 'Execute Tests';
  readonly activeLabel = 'Running test suite...';

  async execute(ctx: PipelineContext): Promise<StepResult> {
    if (!ctx.testCmd) {
      log(`⏭  No test command configured — skipping test execution`);
      const result: TestResult = {
        passed: true,
        skipped: true,
        output: 'No test command configured (autoSpecKit.testCommand)',
        coverage: null,
        durationMs: 0,
        command: '',
      };
      return {
        output: result.output,
        data: { testResult: result },
      };
    }

    log(`🧪 Running: ${ctx.testCmd}`);
    const startMs = Date.now();

    let stdout = '';
    let stderr = '';
    let passed = false;

    try {
      const result = await execAsync(ctx.testCmd, {
        cwd: ctx.workspaceRoot,
        timeout: 120_000, // 2 minute timeout
        maxBuffer: 10 * 1024 * 1024, // 10MB
        env: { ...process.env, FORCE_COLOR: '0' },
      });
      stdout = result.stdout;
      stderr = result.stderr;
      passed = true;
    } catch (err: any) {
      stdout = err.stdout ?? '';
      stderr = err.stderr ?? '';
      passed = false;
    }

    const durationMs = Date.now() - startMs;
    const fullOutput = `${stdout}\n${stderr}`.trim();
    const coverage = parseCoverage(fullOutput);

    const testResult: TestResult = {
      passed,
      skipped: false,
      output: fullOutput,
      coverage,
      durationMs,
      command: ctx.testCmd,
    };

    log(`${passed ? '✅' : '❌'} Tests ${passed ? 'passed' : 'failed'} in ${(durationMs / 1000).toFixed(1)}s`);
    if (coverage !== null) {
      log(`📊 Coverage: ${coverage}%`);
    }

    return {
      output: fullOutput,
      data: { testResult },
    };
  }
}
