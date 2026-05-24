import * as vscode from 'vscode';

export async function askComment(label: string): Promise<string | undefined> {
  const choice = await vscode.window.showQuickPick(
    ['💬 Yes — I want to add feedback', '⏭  No — Skip and continue'],
    { title: `Review Checkpoint: ${label}`, placeHolder: 'Do you want to add a comment?' }
  );
  if (!choice || choice.startsWith('⏭')) { return undefined; }

  return vscode.window.showInputBox({
    title: `Feedback for ${label}`,
    prompt: 'Enter feedback / change requests',
    placeHolder: 'e.g. Add validation for email field, handle edge case when user is null...',
  });
}
