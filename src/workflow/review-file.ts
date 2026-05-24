import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

import { log, stepHeader } from '../logger';
import { callCopilot } from '../utils/copilot';
import { loadKnowledgeBase } from '../utils/file-utils';
import { loadGitContext, formatGitContextForPrompt } from '../utils/git-utils';

export async function reviewCurrentFile(
  document: vscode.TextDocument,
  workspaceRoot: string,
  model: vscode.LanguageModelChat,
  token: vscode.CancellationToken,
  extensionPath: string
): Promise<void> {

  const cfg       = vscode.workspace.getConfiguration('autoSpecKit');
  const kbRelPath = cfg.get<string>('knowledgeBasePath', 'knowledge-base');

  // 1. Read file content
  const fileContent = document.getText();
  // 2. Get relative path
  const relPath = path.relative(workspaceRoot, document.uri.fsPath);

  stepHeader(1, 1, `REVIEWING: ${relPath}`);
  log(`ℹ  File : ${relPath}`);
  log(`ℹ  Size : ${(fileContent.length / 1024).toFixed(1)}KB  (${document.lineCount} lines)`);

  // 3. Load KB
  const kb = loadKnowledgeBase(workspaceRoot, kbRelPath);

  // 4. Load review skills — KB version (preferred) or universal fallback
  let reviewSkills = '';
  let reviewSkillsSource = '';

  const kbReviewPath = path.join(workspaceRoot, kbRelPath, 'review-skills.md');
  const universalPath = path.join(extensionPath, 'resources', 'review-skills-universal.md');

  try {
    if (fs.existsSync(kbReviewPath)) {
      const content = fs.readFileSync(kbReviewPath, 'utf-8');
      if (content.trim().length > 500) {
        reviewSkills = content;
        reviewSkillsSource = `KB review-skills.md (${(content.length / 1024).toFixed(1)}KB — universal + project-specific)`;
      }
    }
    if (!reviewSkills && fs.existsSync(universalPath)) {
      reviewSkills = fs.readFileSync(universalPath, 'utf-8');
      reviewSkillsSource = `Universal template (${(reviewSkills.length / 1024).toFixed(1)}KB — run "Generate KB" for project-specific rules)`;
    }
  } catch { /* skip */ }

  if (reviewSkillsSource) {
    log(`✅ Review skills: ${reviewSkillsSource}`);
  } else {
    log(`⚠  review-skills.md not found — using generic checklist`);
  }

  // 5. Load git context for this file
  log('ℹ  Loading git context...');
  const gitCtx = loadGitContext(workspaceRoot, [relPath]);
  const gitBlock = formatGitContextForPrompt(gitCtx);

  // 6. Build SYSTEM context
  const SYSTEM = `\
You are a Principal Software Engineer AND Business Analyst performing a two-phase code review.

=== PROJECT KNOWLEDGE BASE ===
${kb || '(No knowledge base found — use general best practices.)'}

${reviewSkills ? `=== REVIEW SKILLS & STANDARDS (apply ALL sections) ===
${reviewSkills}` : ''}

=== REVIEW RULES ===
1. Phase 1 — apply EVERY section in Review Skills as your checklist. Do not skip any section.
2. Phase 2 — check business consistency: does this file break existing business rules / flows?
3. For EVERY issue: output the EXACT bad code → explain why (in English) → output complete fixed code.
4. Never write "add X here" — always show the actual code to add.
5. Classify: [CRITICAL] = must fix before commit | [MAJOR] = should fix | [MINOR] = nice to fix.
6. Write all explanations in English, all code blocks in English.
7. Section 14 (Project-Specific Rules) has highest priority if present.`;

  // 7. Build review prompt with git diff context + actionable output format
  const reviewPrompt = `\
# Code Review: \`${relPath}\`

## FILE CONTENT (${document.lineCount} lines):
\`\`\`
${fileContent}
\`\`\`

---

## GIT CONTEXT (comparison vs default branch and working tree):
${gitBlock}

---

# REVIEW INSTRUCTIONS

## Phase 1 — Code Quality
${reviewSkills
    ? `Go through EVERY SECTION in Review Skills.
For each section: list issues (citing file + function + line) or "✅ Clean". Do not skip any section.`
    : `Evaluate: Correctness, Security, Architecture, Performance, Code Quality, Testability.`}

## Phase 2 — Business Consistency
Cross-reference with Knowledge Base:
- Does this file violate any business rule in the KB?
- Is any important business logic deleted/overridden?
- Are state transitions valid?
- Is the API contract changed?

---

# OUTPUT FORMAT — REQUIRED

## 📋 SECTION COVERAGE
| Section | Status | Issues count |
|---------|--------|-------------|
| Security | ✅/⚠️/❌/N/A | 0 |
| Architecture | | |
| Performance | | |
| [each section from review-skills] | | |

## 🏢 BUSINESS CONSISTENCY
| Check | Result | Notes |
|-------|--------|-------|
| Business rules intact | ✅/❌ | |
| No logic removed | ✅/❌ | |
| State machine valid | ✅/❌/N/A | |

---

## 🐛 ISSUES (each issue MUST have all 4 parts)

### Issue #N — [CRITICAL/MAJOR/MINOR] · \`functionName()\` · line ~XX
> **Problem:** [explain in English — why it's wrong, business/technical impact]

**❌ Bad code (current):**
\`\`\`
// paste exact problematic code — enough context
\`\`\`

**✅ Fixed code (complete, no placeholders):**
\`\`\`
// paste complete corrected code
\`\`\`

---

## ✅ STRENGTHS (at least 3 specific points)

## 🎯 VERDICT: APPROVED / NEEDS_REVISION
## 📊 QUALITY SCORE: X/10 — [short reason]`;

  const reviewResult = await callCopilot(model, SYSTEM, reviewPrompt, token, `Review: ${relPath}`);

  // 7. Build result document with timestamp
  const timestamp  = new Date().toLocaleString('en-US');
  const docContent = `# 🔍 Code Review: \`${relPath}\`
_${timestamp}_

---

${reviewResult}
`;

  // 8. Open result in new document
  const resultDoc = await vscode.workspace.openTextDocument({
    content: docContent,
    language: 'markdown',
  });
  await vscode.window.showTextDocument(resultDoc, { preview: false, viewColumn: vscode.ViewColumn.Beside });

  log(`\n✅ Review complete for: ${relPath}`);
}
