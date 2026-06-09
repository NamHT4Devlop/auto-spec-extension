export { PipelineRunner } from './runner';
export type { PipelineContext, PipelineStep, StepResult, SessionState } from './types';

import { Step01Planning } from './steps/step-01-planning';
import { Step02PlanReview } from './steps/step-02-plan-review';
import { Step03PlanFeedback } from './steps/step-03-plan-feedback';
import { Step04CodeGeneration } from './steps/step-04-code-generation';
import { Step05CodeReview } from './steps/step-05-code-review';
import { Step06CodeFeedback } from './steps/step-06-code-feedback';
import { Step07WriteTests } from './steps/step-07-write-tests';
import { Step08TestReview } from './steps/step-08-test-review';
import { Step09TestFeedback } from './steps/step-09-test-feedback';
import { Step10SaveFiles } from './steps/step-10-save-files';
import { Step11ExecuteTests } from './steps/step-11-execute-tests';
import { Step12Evidence } from './steps/step-12-evidence';
import { Step13UpdateKB } from './steps/step-13-update-kb';

export const ALL_STEPS = [
  new Step01Planning(),
  new Step02PlanReview(),
  new Step03PlanFeedback(),
  new Step04CodeGeneration(),
  new Step05CodeReview(),
  new Step06CodeFeedback(),
  new Step07WriteTests(),
  new Step08TestReview(),
  new Step09TestFeedback(),
  new Step10SaveFiles(),
  new Step11ExecuteTests(),
  new Step12Evidence(),
  new Step13UpdateKB(),
];
