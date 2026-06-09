import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

import { log, kbHeader, getChannel } from '../logger';
import { callCopilot } from '../utils/copilot';
import { loadKnowledgeBase } from '../utils/file-utils';

const execAsync = promisify(exec);

export async function updateKBStandalone(
  workspaceRoot: string,
  model: vscode.LanguageModelChat,
  token: vscode.CancellationToken,
  progress: vscode.Progress<{ message?: string; increment?: number }>
): Promise<void> {

  // 1. Read config
  const cfg       = vscode.workspace.getConfiguration('autoSpecKit');
  const kbRelPath = cfg.get<string>('knowledgeBasePath', 'knowledge-base');
  const kbPath    = path.join(workspaceRoot, kbRelPath);

  // 2. Check KB exists
  if (!fs.existsSync(kbPath)) {
    vscode.window.showErrorMessage(
      `Auto Spec Kit: Knowledge Base not found at "${kbRelPath}". Please run "Generate Knowledge Base" first.`
    );
    return;
  }

  // 3. Show InputBox for user description
  const userDescription = await vscode.window.showInputBox({
    title: '📚 Update Knowledge Base',
    prompt: 'Describe the changes you just made:',
    placeHolder: 'e.g. Added Payment entity, refactored AuthService, restructured modules folder...',
    ignoreFocusOut: true,
  });
  if (!userDescription?.trim()) { return; }

  kbHeader(1, 1, 'UPDATE KNOWLEDGE BASE');
  log(`ℹ  Description: ${userDescription}`);
  progress.report({ message: 'Analysing changes...', increment: 20 });

  // 4. Try to get git diff
  let gitDiff = '';
  try {
    const { stdout } = await execAsync('git diff --name-only HEAD~1', { cwd: workspaceRoot });
    gitDiff = stdout.trim();
    if (gitDiff) {
      log(`ℹ  Git diff (changed files):\n${gitDiff}`);
    }
  } catch {
    // git not available or no commits — that's fine
    log('ℹ  Git diff not available — proceeding with user description only');
  }

  // 5. Load KB
  const kb = loadKnowledgeBase(workspaceRoot, kbRelPath);

  // 6. Build SYSTEM with KB context
  const SYSTEM = `\
You are a senior software engineer maintaining a living knowledge base for a codebase.

=== CURRENT KNOWLEDGE BASE ===
${kb}

=== RULES ===
1. Analyze the described changes carefully.
2. Only update KB sections that are ACTUALLY affected by the changes.
3. Output concise delta content — do NOT repeat existing content.
4. Write all documentation and explanations in English.`;

  progress.report({ message: 'Calling Copilot for delta analysis...', increment: 30 });

  const today = new Date().toISOString().slice(0, 10);

  // 7. Call Copilot with delta prompt
  const deltaPrompt = `\
Analyze the changes below and generate content to UPDATE the knowledge base.

## CHANGES DESCRIPTION:
${userDescription}

## GIT DIFF (if available):
${gitDiff || '(no git diff available)'}

## TASK:
Generate delta content to append to KB files. Only include what ACTUALLY changed.

## OUTPUT FORMAT:
### UPDATE: knowledge-base/[filename].md
\`\`\`
---
## Update: ${today} — ${userDescription.slice(0, 50)}

[Delta content — concise, do not repeat existing content]
\`\`\`

Files that may need updating: 04-business-overview.md, 05-domain-model.md, 06-modules.md, 08-database-schema.md, 11-api-docs.md, 12-conventions.md, review-skills.md
⚠️ Only output files that ACTUALLY changed. If nothing is new: "(no update needed)".`;

  const deltaResult = await callCopilot(model, SYSTEM, deltaPrompt, token, 'Update KB Delta');

  progress.report({ message: 'Applying updates to KB files...', increment: 30 });

  // 8. Parse UPDATE: pattern and append to KB files
  const updatePattern = /###\s*UPDATE:\s*([^\n]+)\n```[^\n]*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  const updatedFiles: string[] = [];
  let firstUpdatedPath: string | undefined;

  while ((match = updatePattern.exec(deltaResult)) !== null) {
    const kbFilePath = match[1].trim();
    const kbContent  = match[2].trim();
    const fullPath   = path.join(workspaceRoot, kbFilePath);

    if (kbContent && kbContent !== '(no update needed)') {
      if (fs.existsSync(fullPath)) {
        fs.appendFileSync(fullPath, `\n\n${kbContent}\n`, 'utf-8');
        updatedFiles.push(kbFilePath);
        if (!firstUpdatedPath) { firstUpdatedPath = fullPath; }
        log(`✅ KB updated → ${kbFilePath}`);
      } else {
        log(`⚠  KB file does not exist, skipping: ${kbFilePath}`);
      }
    }
  }

  progress.report({ message: 'Done.', increment: 20 });

  // 9. Show summary notification
  if (updatedFiles.length === 0) {
    log('ℹ  No KB files needed updating');
    vscode.window.showInformationMessage('📚 Auto Spec Kit: No changes detected in KB.');
  } else {
    log(`\n✅ Updated ${updatedFiles.length} KB file(s): ${updatedFiles.join(', ')}`);
    vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');

    const action = await vscode.window.showInformationMessage(
      `📚 Knowledge Base updated: ${updatedFiles.length} file(s) — ${updatedFiles.join(', ')}`,
      'View updated file'
    );

    // 10. Open updated file in editor if available
    if (action === 'View updated file' && firstUpdatedPath) {
      const doc = await vscode.workspace.openTextDocument(firstUpdatedPath);
      await vscode.window.showTextDocument(doc, { preview: false });
    }
  }
}
