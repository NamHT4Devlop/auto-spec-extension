import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { log } from '../../../logger';
import { extractFiles } from '../../../utils/file-utils';
import { PipelineContext, PipelineStep, StepResult } from '../types';
import { ExtractedFile } from '../../../types';

export class Step10SaveFiles implements PipelineStep {
  readonly id = 'step-10';
  readonly name = 'Save Files';
  readonly activeLabel = 'Extracting and saving files...';

  async execute(ctx: PipelineContext): Promise<StepResult> {
    // Use final code and final tests
    const codeFinal = ctx.stepOutputs.get('step-06')?.output ?? '';
    const testsFinal = ctx.stepOutputs.get('step-09')?.output ?? '';

    // Extract files from both code and test outputs
    const codeFiles = extractFiles(codeFinal);
    const testFiles = extractFiles(testsFinal);
    const allFiles: ExtractedFile[] = [...codeFiles, ...testFiles];

    log(`📦 Extracted ${codeFiles.length} code file(s) and ${testFiles.length} test file(s)`);

    // Save all files to session directory
    const filesDir = path.join(ctx.sessionDir, '07-files');
    fs.mkdirSync(filesDir, { recursive: true });

    for (const file of allFiles) {
      const destPath = path.join(filesDir, file.filePath);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, file.code, 'utf-8');
      log(`   💾 ${file.filePath}`);
    }

    // Determine whether to apply to the project
    let applyToProject = ctx.autoApply;

    if (!applyToProject) {
      const choice = await vscode.window.showQuickPick(
        [
          { label: '✅ Apply to project', description: 'Copy files to workspace', apply: true },
          { label: '📁 Keep in session only', description: 'Files saved in session folder', apply: false },
        ],
        {
          title: 'Apply generated files to project?',
          placeHolder: `${allFiles.length} files ready`,
        }
      );
      applyToProject = choice?.apply ?? false;
    }

    if (applyToProject) {
      for (const file of allFiles) {
        const destPath = path.join(ctx.workspaceRoot, file.filePath);
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.writeFileSync(destPath, file.code, 'utf-8');
        log(`   📂 Applied: ${file.filePath}`);
      }
      log(`✅ ${allFiles.length} file(s) applied to project`);
    } else {
      log(`📁 Files saved in session directory only`);
    }

    // Build summary output
    const fileList = allFiles.map((f) => f.filePath).join('\n');
    const summary = `Saved ${allFiles.length} files:\n${fileList}\nApplied to project: ${applyToProject}`;

    return {
      output: summary,
      data: {
        allFiles: allFiles.map((f) => ({ filePath: f.filePath, size: f.code.length })),
        appliedToProject: applyToProject,
        totalFiles: allFiles.length,
      },
    };
  }
}
