import * as vscode from 'vscode';

export interface StepResult {
  /** Raw output from this step */
  output: string;
  /** Optional structured data (extracted files, test results, etc.) */
  data?: Record<string, any>;
}

export interface PipelineContext {
  // Inputs
  requirement: string;
  workspaceRoot: string;
  model: vscode.LanguageModelChat;
  token: vscode.CancellationToken;
  progress: vscode.Progress<{ message?: string; increment?: number }>;
  extensionPath: string;

  // Config
  lang: string;
  kbRelPath: string;
  testCmd: string;
  autoApply: boolean;
  sessionsDir: string;

  // Runtime state
  sessionDir: string;
  kb: string;
  reviewSkills: string;
  systemPrompt: string;

  // Step outputs (accumulated as pipeline runs)
  stepOutputs: Map<string, StepResult>;
}

export interface PipelineStep {
  id: string;
  name: string;
  /** Present continuous form for progress display */
  activeLabel: string;
  execute(ctx: PipelineContext): Promise<StepResult>;
}

export interface SessionState {
  requirement: string;
  sessionDir: string;
  completedSteps: string[];
  stepOutputs: Record<string, StepResult>;
  timestamp: string;
}
