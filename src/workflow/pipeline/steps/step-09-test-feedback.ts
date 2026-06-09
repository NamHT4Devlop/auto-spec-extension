import { log } from '../../../logger';
import { callCopilot } from '../../../utils/copilot';
import { askComment } from '../../../utils/checkpoint';
import { saveFile } from '../../../utils/file-utils';
import { PipelineContext, PipelineStep, StepResult } from '../types';

export class Step09TestFeedback implements PipelineStep {
  readonly id = 'step-09';
  readonly name = 'Test Feedback';
  readonly activeLabel = 'Collecting test feedback...';

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const ai = (prompt: string, label: string) =>
      callCopilot(ctx.model, ctx.systemPrompt, prompt, ctx.token, label);

    const tests = ctx.stepOutputs.get('step-07')?.output ?? '';
    const testsReview = ctx.stepOutputs.get('step-08')?.output ?? '';

    // Check if review found issues needing changes
    const needsChanges = /NEEDS_CHANGES/i.test(testsReview);

    // Ask the user for optional feedback
    const feedback = await askComment('Tests');

    if (!feedback && !needsChanges) {
      // No feedback and no critical issues — use original tests as final
      log(`✅ No feedback and review approved — using original tests as final.`);
      return { output: tests, data: { hadFeedback: false, revised: false } };
    }

    // Regenerate tests incorporating review feedback + user comments
    const codeFinal = ctx.stepOutputs.get('step-06')?.output ?? '';

    const prompt = `\
You are fixing tests based on review feedback and user comments.

=== IMPLEMENTATION CODE ===
${codeFinal}

=== CURRENT TESTS ===
${tests}

=== TEST REVIEW FINDINGS ===
${testsReview}

=== USER FEEDBACK ===
${feedback || '(No user feedback)'}

=== INSTRUCTIONS ===
1. Address ALL issues from the test review.
2. Incorporate any user feedback.
3. Output the COMPLETE revised test suite (not just patches).
4. Keep the ### FILE: prefix format for each test file.
5. Ensure no regressions — maintain all existing test coverage.`;

    const revisedTests = await ai(prompt, 'Test Revision');

    saveFile(ctx.sessionDir, '05-tests/tests-final.md', revisedTests);
    log(`📄 Revised tests saved to 05-tests/tests-final.md`);

    return { output: revisedTests, data: { hadFeedback: !!feedback, revised: true } };
  }
}
