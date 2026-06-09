import { log } from '../../../logger';
import { callCopilot } from '../../../utils/copilot';
import { askComment } from '../../../utils/checkpoint';
import { saveFile } from '../../../utils/file-utils';
import { PipelineContext, PipelineStep, StepResult } from '../types';

export class Step06CodeFeedback implements PipelineStep {
  readonly id = 'step-06';
  readonly name = 'Code Feedback';
  readonly activeLabel = 'Collecting code feedback...';

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const ai = (prompt: string, label: string) =>
      callCopilot(ctx.model, ctx.systemPrompt, prompt, ctx.token, label);

    const code = ctx.stepOutputs.get('step-04')?.output ?? '';
    const codeReview = ctx.stepOutputs.get('step-05')?.output ?? '';

    // Check if review found issues needing changes
    const needsChanges = /NEEDS_CHANGES/i.test(codeReview);

    // Ask the user for optional feedback
    const feedback = await askComment('Code');

    if (!feedback && !needsChanges) {
      // No feedback and no critical issues — use original code as final
      log(`✅ No feedback and review approved — using original code as final.`);
      return { output: code, data: { hadFeedback: false, revised: false } };
    }

    // Regenerate code incorporating review feedback + user comments
    const planFinal = ctx.stepOutputs.get('step-03')?.output ?? '';

    const prompt = `\
You are fixing code based on review feedback and user comments.

=== ORIGINAL REQUIREMENT ===
${ctx.requirement}

=== IMPLEMENTATION PLAN ===
${planFinal}

=== CURRENT CODE ===
${code}

=== CODE REVIEW FINDINGS ===
${codeReview}

=== USER FEEDBACK ===
${feedback || '(No user feedback)'}

=== INSTRUCTIONS ===
1. Address ALL issues from the code review (especially CRITICAL and MAJOR).
2. Incorporate any user feedback.
3. Output the COMPLETE revised code (not just patches).
4. Keep the ### FILE: prefix format for each file.
5. Ensure no regressions — maintain all existing functionality.`;

    const revisedCode = await ai(prompt, 'Code Revision');

    saveFile(ctx.sessionDir, '03-code/code-final.md', revisedCode);
    log(`📄 Revised code saved to 03-code/code-final.md`);

    return { output: revisedCode, data: { hadFeedback: !!feedback, revised: true } };
  }
}
