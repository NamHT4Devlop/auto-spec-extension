import { log } from '../../../logger';
import { callCopilot } from '../../../utils/copilot';
import { askComment } from '../../../utils/checkpoint';
import { saveFile } from '../../../utils/file-utils';
import { PipelineContext, PipelineStep, StepResult } from '../types';

export class Step03PlanFeedback implements PipelineStep {
  readonly id = 'step-03';
  readonly name = 'Plan Feedback';
  readonly activeLabel = 'Collecting plan feedback...';

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const ai = (prompt: string, label: string) =>
      callCopilot(ctx.model, ctx.systemPrompt, prompt, ctx.token, label);

    const plan = ctx.stepOutputs.get('step-01')?.output ?? '';
    const planReview = ctx.stepOutputs.get('step-02')?.output ?? '';

    // Ask the user for optional feedback
    const feedback = await askComment('Plan');

    if (!feedback) {
      // No feedback — use original plan as final
      log(`✅ No feedback — using original plan as final.`);
      return { output: plan, data: { hadFeedback: false } };
    }

    // Regenerate plan incorporating AI review + user feedback
    const prompt = `\
You are revising an implementation plan based on review feedback and user comments.

=== ORIGINAL REQUIREMENT ===
${ctx.requirement}

=== ORIGINAL PLAN ===
${plan}

=== AI REVIEW FEEDBACK ===
${planReview}

=== USER FEEDBACK ===
${feedback}

=== INSTRUCTIONS ===
1. Address ALL points raised in both the AI review and user feedback.
2. Produce a revised, complete plan (not just the changes).
3. Keep the same Markdown structure but incorporate improvements.`;

    const revisedPlan = await ai(prompt, 'Plan Revision');

    saveFile(ctx.sessionDir, '01-plan/plan-final.md', revisedPlan);
    log(`📄 Revised plan saved to 01-plan/plan-final.md`);

    return { output: revisedPlan, data: { hadFeedback: true, feedback } };
  }
}
