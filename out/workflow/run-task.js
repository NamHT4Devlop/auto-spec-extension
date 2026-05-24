"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runWorkflow = runWorkflow;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const logger_1 = require("../logger");
const copilot_1 = require("../utils/copilot");
const file_utils_1 = require("../utils/file-utils");
const coverage_1 = require("../utils/coverage");
const checkpoint_1 = require("../utils/checkpoint");
const git_utils_1 = require("../utils/git-utils");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
/** Load review-skills.md from KB (preferred) or fallback to universal template from extension */
function loadReviewSkills(workspaceRoot, kbRelPath, extensionPath) {
    // Priority 1: KB review-skills.md (universal template + project-specific section 14)
    const kbReviewPath = path.join(workspaceRoot, kbRelPath, 'review-skills.md');
    if (fs.existsSync(kbReviewPath)) {
        const content = fs.readFileSync(kbReviewPath, 'utf-8');
        if (content.trim().length > 500) { // sanity check — not an empty file
            (0, logger_1.log)(`✅ Review skills loaded from KB: ${kbRelPath}/review-skills.md (${(content.length / 1024).toFixed(1)}KB)`);
            return content;
        }
    }
    // Priority 2: Universal template bundled with extension
    const universalPath = path.join(extensionPath, 'resources', 'review-skills-universal.md');
    if (fs.existsSync(universalPath)) {
        const content = fs.readFileSync(universalPath, 'utf-8');
        (0, logger_1.log)(`✅ Review skills loaded from extension resources: review-skills-universal.md (${(content.length / 1024).toFixed(1)}KB)`);
        (0, logger_1.log)(`   ⚠  No KB found → Section 14 (project-specific rules) is missing. Run "Generate KB" for a full review.`);
        return content;
    }
    (0, logger_1.log)(`⚠  review-skills.md not found — using generic checklist`);
    return '';
}
async function runWorkflow(requirement, workspaceRoot, model, token, progress, extensionPath) {
    // ── Config ──────────────────────────────────────────────────────
    const cfg = vscode.workspace.getConfiguration('autoSpecKit');
    const lang = cfg.get('language', 'typescript');
    const kbRelPath = cfg.get('knowledgeBasePath', 'knowledge-base');
    const testCmd = cfg.get('testCommand', '');
    const autoApply = cfg.get('autoApplyCode', false);
    const sessionsDir = cfg.get('sessionsDir', 'spec-kit-sessions');
    // ── Session dir ─────────────────────────────────────────────────
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const slug = requirement.slice(0, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');
    const sessionDir = path.join(workspaceRoot, sessionsDir, `${ts}-${slug}`);
    for (const sub of ['01-plan', '02-plan-review', '03-code', '04-code-review',
        '05-tests', '06-test-review', '07-evidence', '08-files']) {
        fs.mkdirSync(path.join(sessionDir, sub), { recursive: true });
    }
    (0, logger_1.log)(`✅ Session: ${sessionDir}`);
    // ── Knowledge base ──────────────────────────────────────────────
    const kb = (0, file_utils_1.loadKnowledgeBase)(workspaceRoot, kbRelPath);
    // ── Review skills (universal template + project-specific) ───────
    const reviewSkills = loadReviewSkills(workspaceRoot, kbRelPath, extensionPath);
    // ── System context (injected into every AI call) ────────────────
    const SYSTEM = `\
You are a senior software engineer implementing tasks inside a real codebase.

=== PROJECT KNOWLEDGE BASE ===
${kb || '(No knowledge base found. Use general best practices.)'}

=== ABSOLUTE RULES ===
1. Follow the EXACT patterns, naming conventions, and folder structure from the knowledge base.
2. When outputting source files, ALWAYS prefix each file's code block with:
   ### FILE: <exact/relative/path/to/file.ext>
3. Write complete, production-ready code — NO placeholders, NO skeleton TODOs.
4. Match the project's error handling, logging, and validation patterns exactly.
5. Language/runtime: ${lang}
6. Write all explanations in English. Write code and code comments in English.`;
    const TOTAL_STEPS = 13;
    const inc = Math.floor(100 / TOTAL_STEPS);
    const step = (n, title) => {
        (0, logger_1.stepHeader)(n, TOTAL_STEPS, title);
        progress.report({ message: `Step ${n}/${TOTAL_STEPS}: ${title}`, increment: inc });
    };
    const ai = (prompt, label) => (0, copilot_1.callCopilot)(model, SYSTEM, prompt, token, label);
    // ══════════════════════════════════════════════════════════════
    // STEP 01 — PLAN
    // ══════════════════════════════════════════════════════════════
    step(1, 'PLANNING');
    const plan01 = await ai(`\
I need to implement the following requirement:

## REQUIREMENT
${requirement}

Create a DETAILED implementation plan including:

### 1. REQUIREMENT ANALYSIS
- Scope: what to do / what not to do
- Acceptance Criteria (≥5, specific and measurable)
- Important edge cases to handle

### 2. TECHNICAL DESIGN
- Modules / layers affected
- Files to CREATE (full relative path following project structure)
- Files to MODIFY (full path + description of changes)
- DB migration needed? If yes, describe schema changes

### 3. IMPLEMENTATION STEPS (ordered by dependency)
[ ] Step 1: ...
[ ] Step 2: ...

### 4. BUSINESS RULES from the knowledge base applicable here

### 5. RISK ASSESSMENT
- Breaking changes?
- Performance impact?
- Security concerns?

### 6. ESTIMATE — Complexity: Simple/Medium/Complex | Time: X hours

⚠️ Do NOT generate code in this step.`, 'Planning');
    (0, file_utils_1.saveFile)(sessionDir, '01-plan/plan.md', `# Implementation Plan\n\n**Requirement:** ${requirement}\n\n${plan01}`);
    (0, logger_1.log)('✅ Saved → 01-plan/plan.md');
    // ══════════════════════════════════════════════════════════════
    // STEP 02 — REVIEW PLAN
    // ══════════════════════════════════════════════════════════════
    step(2, 'REVIEWING PLAN');
    const planReview = await ai(`\
Review the following plan for requirement: "${requirement}"

## PLAN TO REVIEW:
${plan01}

## REVIEW CRITERIA:

### ✅ COMPLETENESS
- Does the plan fully cover the requirement? Any missing ACs?
- Any important edge cases overlooked?

### 🏗 ARCHITECTURE
- Is the approach consistent with the architecture in the knowledge base?
- Any violation of separation of concerns?

### ⚠️ RISKS
- Breaking changes not flagged?
- Security / performance risks?

### 📝 ISSUES (format):
- [CRITICAL] description → fix
- [SUGGESTION] description → fix

### 🎯 VERDICT: APPROVED / NEEDS_REVISION (+ one-line reason)`, 'Review Plan');
    (0, file_utils_1.saveFile)(sessionDir, '02-plan-review/review.md', `# Plan Review\n\n${planReview}`);
    (0, logger_1.log)('✅ Saved → 02-plan-review/review.md');
    // ══════════════════════════════════════════════════════════════
    // STEP 03 — COMMENT & FINALIZE PLAN
    // ══════════════════════════════════════════════════════════════
    step(3, 'PLAN FEEDBACK CHECKPOINT');
    const planComment = await (0, checkpoint_1.askComment)('Plan');
    let planFinal;
    if (planComment) {
        (0, logger_1.log)(`ℹ  Updating plan with feedback: "${planComment}"`);
        planFinal = await ai(`\
Update the plan with AI review and user feedback.

## ORIGINAL REQUIREMENT: ${requirement}
## CURRENT PLAN:
${plan01}
## AI REVIEW:
${planReview}
## USER FEEDBACK:
${planComment}

→ Generate the COMPLETE improved plan.
  Mark [UPDATED] before each line changed from the original plan.`, 'Update Plan');
        (0, file_utils_1.saveFile)(sessionDir, '01-plan/plan-final.md', `# Final Plan\n\n**Feedback:** ${planComment}\n\n${planFinal}`);
    }
    else {
        planFinal = plan01;
        (0, file_utils_1.saveFile)(sessionDir, '01-plan/plan-final.md', `# Final Plan\n\n${plan01}`);
        (0, logger_1.log)('✅ Plan finalized (no changes)');
    }
    // ══════════════════════════════════════════════════════════════
    // STEP 04 — CODE GENERATION
    // ══════════════════════════════════════════════════════════════
    step(4, 'CODE GENERATION');
    const ext = lang === 'typescript' ? 'ts' : lang === 'javascript' ? 'js' :
        lang === 'python' ? 'py' : lang === 'java' ? 'java' : lang;
    const code04 = await ai(`\
Implement ALL code for the requirement based on the approved plan.

## REQUIREMENT: ${requirement}

## APPROVED PLAN:
${planFinal}

## REQUIRED — Format for each file:
### FILE: src/modules/example/example.service.${ext}
\`\`\`${lang}
// code here
\`\`\`

## CODE REQUIREMENTS:
- Language: ${lang}
- Follow EXACT conventions from the knowledge base (naming, structure, patterns)
- Use the CORRECT error handling / logging / validation patterns
- NO placeholders or important TODOs — code must be production-ready
- Full type annotations
- All business rules in the plan must be fully implemented

Order: entity/model → repository/DAO → service → controller → DTO/schema`, 'Generate Code');
    (0, file_utils_1.saveFile)(sessionDir, '03-code/code-raw.md', code04);
    (0, logger_1.log)('✅ Saved → 03-code/code-raw.md');
    // ══════════════════════════════════════════════════════════════
    // STEP 05 — CODE REVIEW (two-phase: quality + business consistency)
    //   Phase 1: code quality per review-skills-universal.md (all sections)
    //   Phase 2: business consistency vs KB + existing code on default branch
    // ══════════════════════════════════════════════════════════════
    step(5, 'CODE REVIEW');
    // ── Load git context for files being changed ─────────────────
    (0, logger_1.log)('ℹ  Loading git context for review...');
    const newFilePaths = (0, file_utils_1.extractFiles)(code04).map(f => f.filePath);
    const gitCtx = (0, git_utils_1.loadGitContext)(workspaceRoot, newFilePaths);
    const gitContextBlock = (0, git_utils_1.formatGitContextForPrompt)(gitCtx);
    const reviewSystemPrompt = `\
You are a Principal Software Engineer AND Business Analyst performing a two-phase code review.

=== PROJECT KNOWLEDGE BASE (business rules, conventions, domain model) ===
${kb || '(No knowledge base found — use general best practices.)'}

${reviewSkills ? `=== REVIEW SKILLS & STANDARDS (apply ALL sections) ===
${reviewSkills}` : ''}

=== REVIEW RULES ===
1. Phase 1 (Code Quality): apply EVERY section in Review Skills as your checklist.
2. Phase 2 (Business): check that new code does NOT break existing business rules from KB.
3. For EVERY issue found — output the EXACT bad code, explain why it's wrong, then output the COMPLETE fixed code.
4. Never say "add validation here" without showing exactly what code to add.
5. Classify: [CRITICAL] = must fix before merge | [MAJOR] = should fix | [MINOR] = nice to fix.
6. Write all explanations in English. Write all code blocks in English.
7. If Section 14 (Project-Specific Rules) exists in Review Skills, enforce with highest priority.`;
    const codeReview = await (0, copilot_1.callCopilot)(model, reviewSystemPrompt, `\
# Code Review — Two Phases

## REQUIREMENT BEING IMPLEMENTED: ${requirement}

## ACCEPTANCE CRITERIA:
${planFinal.match(/Acceptance Criteria[\s\S]*?(?=###|$)/i)?.[0] ?? '(see plan)'}

---

## PHASE 1 INPUT — GENERATED CODE:
${code04}

---

## PHASE 2 INPUT — GIT CONTEXT (comparison vs default branch and current workspace):
${gitContextBlock}

---

# REVIEW INSTRUCTIONS

## PHASE 1 — CODE QUALITY (per Review Skills)
Go through EVERY SECTION in Review Skills.
For each section: list issues (with specific citations) or write "✅ Clean".

## PHASE 2 — BUSINESS CONSISTENCY
Compare new code against:
1. Business rules in the Knowledge Base (04-business-domain, 13-business-rules)
2. Existing code on default branch (from git diff above)

Answer:
- Does the new code violate any currently enforced business rule?
- Is the new logic consistent with existing business flows?
- Does the new code accidentally omit existing business logic? (e.g., overwrite instead of merge)
- State machine transitions: does the new code allow invalid state transitions?

---

# OUTPUT FORMAT — REQUIRED

## 📋 SECTION COVERAGE (Phase 1)
| Section | Status | Issues |
|---------|--------|--------|
| Security | ✅/⚠️/❌/N/A | count |
| Architecture | | |
| Performance | | |
| ... | | |

## 🏢 BUSINESS CONSISTENCY (Phase 2)
| Check | Result | Detail |
|-------|--------|--------|
| Business rules intact | ✅/❌ | ... |
| No existing logic removed | ✅/❌ | ... |
| State machine valid | ✅/❌/N/A | ... |
| API contract unchanged | ✅/❌/N/A | ... |

---

## 🐛 ISSUES (each issue MUST have all 4 parts below)

### Issue #1 — [CRITICAL/MAJOR/MINOR] · \`src/path/file.ts\` · \`functionName()\`
> **Problem:** [describe in English — why this is an issue, what is the business impact]

**❌ Bad code (current):**
\`\`\`typescript
// paste the problematic code (enough context, 5-20 lines)
\`\`\`

**✅ Fixed code (complete):**
\`\`\`typescript
// paste the complete fixed code — no placeholders or TODO comments
\`\`\`

### Issue #2 — ...
[Same format for each issue]

---

## ✅ STRENGTHS (things implemented correctly — at least 3 points)

## 🎯 VERDICT: APPROVED / NEEDS_REVISION
## 📊 QUALITY SCORE: X/10
**Reason:** [1-2 sentence explanation of the score]`, token, 'Review Code');
    (0, file_utils_1.saveFile)(sessionDir, '04-code-review/review.md', `# Code Review\n\n${codeReview}`);
    (0, logger_1.log)('✅ Saved → 04-code-review/review.md');
    // ══════════════════════════════════════════════════════════════
    // STEP 06 — COMMENT & FINALIZE CODE
    // ══════════════════════════════════════════════════════════════
    step(6, 'CODE FEEDBACK CHECKPOINT');
    const codeComment = await (0, checkpoint_1.askComment)('Code');
    const codeHasIssues = /NEEDS_REVISION|\[CRITICAL\]|\[MAJOR\]/.test(codeReview);
    let codeFinal;
    if (codeComment || codeHasIssues) {
        const reason = codeHasIssues ? 'AI found issues' : 'user feedback';
        (0, logger_1.log)(`ℹ  Fixing code (${reason}) ...`);
        codeFinal = await ai(`\
Fix and improve the code based on the review.

## REQUIREMENT: ${requirement}
## PLAN:
${planFinal}
## CURRENT CODE:
${code04}
## REVIEW ISSUES:
${codeReview}
## USER FEEDBACK:
${codeComment ?? '(none)'}

→ Regenerate ALL fixed code.
  Keep the ### FILE: <path> format for each file.
  Only fix the issues identified, do not change what is already correct.`, 'Fix Code');
        (0, file_utils_1.saveFile)(sessionDir, '03-code/code-final.md', codeFinal);
    }
    else {
        codeFinal = code04;
        (0, file_utils_1.saveFile)(sessionDir, '03-code/code-final.md', code04);
        (0, logger_1.log)('✅ Code approved (no changes needed)');
    }
    // ══════════════════════════════════════════════════════════════
    // STEP 07 — WRITE TESTS
    // ══════════════════════════════════════════════════════════════
    step(7, 'WRITING TEST SUITE');
    const tests07 = await ai(`\
Write a comprehensive test suite. GOAL: 100% code coverage + 100% AC coverage.

## REQUIREMENT: ${requirement}

## ACCEPTANCE CRITERIA (must be verified in tests):
${planFinal.match(/Acceptance Criteria[\s\S]*?(?=###|$)/i)?.[0] ?? planFinal}

## CODE TO TEST:
${codeFinal}

## REQUIRED — Format for each test file:
### FILE: src/modules/example/__tests__/example.service.spec.${ext}
\`\`\`${lang}
// test code
\`\`\`

## TEST REQUIREMENTS:
1. Unit tests: every function/method, mock all dependencies
2. Integration tests: if there are API endpoints, test full request→response
3. Test description: "should [expected behavior] when [condition]"
4. Cover: happy path, error cases, edge cases, boundary values
5. 100% statement / branch / function / line coverage
6. Each test MUST be independent (no ordering dependencies)
7. Follow the EXACT test framework from the knowledge base

BEFORE code: list all test cases (table format).
AFTER: implement each case.`, 'Write Tests');
    (0, file_utils_1.saveFile)(sessionDir, '05-tests/tests-raw.md', tests07);
    (0, logger_1.log)('✅ Saved → 05-tests/tests-raw.md');
    // ══════════════════════════════════════════════════════════════
    // STEP 08 — REVIEW TESTS
    // ══════════════════════════════════════════════════════════════
    step(8, 'REVIEWING TEST SUITE');
    const testsReview = await ai(`\
Review the following test suite.

## CODE BEING TESTED (summary of functions/methods):
${codeFinal.split('\n').filter(l => /function|const .* =|async|def |public |private /.test(l)).slice(0, 40).join('\n')}

## TESTS TO REVIEW:
${tests07}

## REVIEW:

### 📊 COVERAGE MAP
For each public function/method, check if there is test coverage:
| Function | Covered? | Test case |
|----------|----------|-----------|

### 🎯 TEST QUALITY
- Tests behavior rather than implementation?
- Descriptions clear?
- Tests independent?
- Mocks accurate?

### ❌ MISSING TEST CASES
- \`function_name\`: Missing test for [scenario]

### 🐛 TEST ISSUES
- [CRITICAL/MAJOR/MINOR] \`test_name\` — Problem → Fix

### 📈 COVERAGE ESTIMATE
| Metric | Est. % |

### 🎯 VERDICT: APPROVED / NEEDS_MORE_TESTS`, 'Review Tests');
    (0, file_utils_1.saveFile)(sessionDir, '06-test-review/review.md', `# Test Review\n\n${testsReview}`);
    (0, logger_1.log)('✅ Saved → 06-test-review/review.md');
    // ══════════════════════════════════════════════════════════════
    // STEP 09 — COMMENT & FINALIZE TESTS
    // ══════════════════════════════════════════════════════════════
    step(9, 'TEST FEEDBACK CHECKPOINT');
    const testsComment = await (0, checkpoint_1.askComment)('Tests');
    const testsNeedMore = /NEEDS_MORE_TESTS|Missing test|\[CRITICAL\]/.test(testsReview);
    let testsFinal;
    if (testsComment || testsNeedMore) {
        (0, logger_1.log)('ℹ  Improving tests ...');
        testsFinal = await ai(`\
Improve the test suite.

## CODE:
${codeFinal}
## CURRENT TESTS:
${tests07}
## REVIEW:
${testsReview}
## USER FEEDBACK:
${testsComment ?? '(none)'}

→ Regenerate the COMPLETE improved test suite.
  Ensure 100% coverage.
  Keep the ### FILE: <path> format.`, 'Update Tests');
        (0, file_utils_1.saveFile)(sessionDir, '05-tests/tests-final.md', testsFinal);
    }
    else {
        testsFinal = tests07;
        (0, file_utils_1.saveFile)(sessionDir, '05-tests/tests-final.md', tests07);
        (0, logger_1.log)('✅ Tests approved (no changes)');
    }
    // ══════════════════════════════════════════════════════════════
    // STEP 10 — SAVE FILES TO DISK
    // ══════════════════════════════════════════════════════════════
    step(10, 'SAVING FILES TO DISK');
    const codeFiles = (0, file_utils_1.extractFiles)(codeFinal);
    const testFiles = (0, file_utils_1.extractFiles)(testsFinal);
    const allFiles = [...codeFiles, ...testFiles];
    // Always save into session directory
    for (const f of allFiles) {
        const dest = path.join(sessionDir, '08-files', f.filePath);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, f.code, 'utf-8');
        (0, logger_1.log)(`✅ [SESSION] ${f.filePath}`);
    }
    // Apply to project?
    let applyToProject = autoApply;
    if (!autoApply && allFiles.length > 0) {
        const choice = await vscode.window.showQuickPick([
            { label: '✅ Yes — Apply to project now', apply: true },
            { label: '📁 No — Save in session folder only', apply: false },
        ], { title: 'Apply code to project?', placeHolder: `Project root: ${workspaceRoot}` });
        applyToProject = choice?.apply ?? false;
    }
    if (applyToProject) {
        for (const f of allFiles) {
            const dest = path.join(workspaceRoot, f.filePath);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, f.code, 'utf-8');
            (0, logger_1.log)(`✅ [PROJECT] Applied → ${f.filePath}`);
        }
        // Refresh VS Code explorer
        vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
    }
    else {
        (0, logger_1.log)(`ℹ  Files saved to session only: ${sessionDir}/08-files/`);
    }
    // ══════════════════════════════════════════════════════════════
    // STEP 11 — EXECUTE TESTS
    // ══════════════════════════════════════════════════════════════
    step(11, 'EXECUTING TESTS');
    let testResult = {
        passed: false, skipped: true, output: '', coverage: null,
        durationMs: 0, command: testCmd || '(not configured)',
    };
    if (!testCmd) {
        (0, logger_1.log)('⚠  autoSpecKit.testCommand is not configured');
        (0, logger_1.log)('   → Go to Settings → Extensions → Auto Spec Kit → Test Command');
        (0, logger_1.log)('   → Example: npx jest --coverage --coverageReporters=text 2>&1');
    }
    else {
        (0, logger_1.log)(`ℹ  Command : ${testCmd}`);
        (0, logger_1.log)(`ℹ  Cwd     : ${workspaceRoot}`);
        const t0 = Date.now();
        try {
            const { stdout, stderr } = await execAsync(testCmd, {
                cwd: workspaceRoot,
                timeout: 300000,
                maxBuffer: 10 * 1024 * 1024,
            });
            const output = (stdout || '') + (stderr || '');
            testResult = {
                passed: true,
                skipped: false,
                output,
                coverage: (0, coverage_1.parseCoverage)(output),
                durationMs: Date.now() - t0,
                command: testCmd,
            };
            (0, logger_1.log)('\n' + output);
            (0, logger_1.log)(`\n✅ ALL TESTS PASSED  (${(testResult.durationMs / 1000).toFixed(1)}s)`);
        }
        catch (err) {
            const output = (err.stdout || '') + (err.stderr || '') + (err.message || '');
            testResult = {
                passed: false,
                skipped: false,
                output,
                coverage: (0, coverage_1.parseCoverage)(output),
                durationMs: Date.now() - t0,
                command: testCmd,
            };
            (0, logger_1.log)('\n' + output);
            (0, logger_1.log)(`\n❌ TESTS FAILED (exit ${err.code})`);
        }
    }
    if (testResult.coverage !== null) {
        const icon = testResult.coverage >= 100 ? '✅' : testResult.coverage >= 80 ? '⚠️' : '❌';
        (0, logger_1.log)(`\n${icon}  Coverage: ${testResult.coverage.toFixed(1)}%`);
    }
    // ══════════════════════════════════════════════════════════════
    // STEP 12 — GENERATE EVIDENCE
    // ══════════════════════════════════════════════════════════════
    step(12, 'GENERATING EVIDENCE');
    const now = new Date().toLocaleString('en-US');
    const status = testResult.skipped ? '⏭ SKIPPED' : testResult.passed ? '✅ PASSED' : '❌ FAILED';
    const covStr = testResult.coverage !== null
        ? (testResult.coverage >= 100 ? `✅ ${testResult.coverage}%` : `⚠️ ${testResult.coverage}%`)
        : 'N/A';
    const duration = testResult.skipped ? 'N/A' : `${(testResult.durationMs / 1000).toFixed(2)}s`;
    if (testResult.output) {
        (0, file_utils_1.saveFile)(sessionDir, '07-evidence/test-output.txt', testResult.output);
        (0, logger_1.log)('✅ Saved → 07-evidence/test-output.txt');
    }
    const fileList = allFiles.map(f => `- \`${f.filePath}\``).join('\n') || '(none extracted)';
    const tailOutput = testResult.output.split('\n').slice(-60).join('\n');
    const evidence = `\
# 📸 Evidence Report

| Field | Value |
|-------|-------|
| **Requirement** | ${requirement} |
| **Session** | ${path.basename(sessionDir)} |
| **Generated** | ${now} |
| **Test Status** | ${status} |
| **Coverage** | ${covStr} |
| **Duration** | ${duration} |
| **Command** | \`${testResult.command}\` |

---

## Workflow Artifacts

| Step | Artifact | Description |
|------|----------|-------------|
| 01 | [\`01-plan/plan-final.md\`](../01-plan/plan-final.md) | Approved implementation plan |
| 02 | [\`02-plan-review/review.md\`](../02-plan-review/review.md) | AI plan review |
| 03 | [\`03-code/code-final.md\`](../03-code/code-final.md) | Final generated code |
| 04 | [\`04-code-review/review.md\`](../04-code-review/review.md) | AI code review |
| 05 | [\`05-tests/tests-final.md\`](../05-tests/tests-final.md) | Final test suite |
| 06 | [\`06-test-review/review.md\`](../06-test-review/review.md) | AI test review |
| 07 | [\`07-evidence/test-output.txt\`](./test-output.txt) | Raw test execution output |

---

## Generated Files (${allFiles.length} files)
${fileList}

---

## Test Output (last 60 lines)
\`\`\`
${tailOutput}
\`\`\`
`;
    (0, file_utils_1.saveFile)(sessionDir, '07-evidence/EVIDENCE.md', evidence);
    (0, logger_1.log)('✅ Saved → 07-evidence/EVIDENCE.md');
    (0, file_utils_1.saveFile)(sessionDir, 'README.md', `\
# Session: ${path.basename(sessionDir)}

| | |
|--|--|
| **Requirement** | ${requirement} |
| **Date** | ${now} |
| **Status** | ${status} |
| **Coverage** | ${covStr} |

## Quick Links
- [Plan](01-plan/plan-final.md)
- [Code](03-code/code-final.md)
- [Tests](05-tests/tests-final.md)
- [Evidence](07-evidence/EVIDENCE.md)
`);
    // Open evidence file
    const evPath = path.join(sessionDir, '07-evidence', 'EVIDENCE.md');
    const doc = await vscode.workspace.openTextDocument(evPath);
    await vscode.window.showTextDocument(doc, { preview: true });
    // ══════════════════════════════════════════════════════════════
    // STEP 13 — UPDATE KNOWLEDGE BASE
    // ══════════════════════════════════════════════════════════════
    step(13, 'UPDATING KNOWLEDGE BASE');
    const kbUpdateChoice = await vscode.window.showQuickPick([
        { label: '⭐ Yes — Update KB with changes from this task', update: true },
        { label: '⏭  No — Skip (not recommended)', update: false },
    ], { title: 'Update Knowledge Base?', placeHolder: 'KB should be updated after every task to always reflect the current business state' });
    if (kbUpdateChoice?.update) {
        (0, logger_1.log)('ℹ  Analyzing delta to update KB ...');
        const kbDelta = await ai(`\
Task has just been implemented. Analyze and generate content to UPDATE the knowledge base.

## TASK IMPLEMENTED
Requirement: ${requirement}

## PLAN (what was designed):
${planFinal}

## CODE GENERATED (summary):
${codeFinal.split('\n').slice(0, 80).join('\n')}

---

## TASK: Analyze DELTA — only what CHANGED from the previous state

### 1. Business/Domain changes?
- New or modified entity/model with important field changes?
- New business rule implemented?
- New user role or permission?
- New workflow?

### 2. Technical changes?
- New API endpoint (method, path, request/response)?
- DB schema changes (new table, column, index)?
- New pattern or convention applied for the first time?

### 3. Lessons learned?
- Any gotcha or pitfall encountered during implementation?
- Any rule that should be added to review-skills.md to prevent recurrence?
- Any convention that was clarified?

---

## OUTPUT FORMAT — For each KB file that needs updating, use this format:

### UPDATE: knowledge-base/[filename].md
\`\`\`
---
## Update: ${new Date().toISOString().slice(0, 10)} — Task: ${requirement.slice(0, 50)}

[Concise delta content — new content only, do not repeat existing content]
\`\`\`

Files that may need updating:
- knowledge-base/04-business-overview.md (new features/flows)
- knowledge-base/05-domain-model.md (new/changed entities)
- knowledge-base/06-modules.md (module changes)
- knowledge-base/08-database-schema.md (schema changes)
- knowledge-base/11-api-docs.md (new endpoints)
- knowledge-base/12-conventions.md (new patterns)
- knowledge-base/review-skills.md (new rules from lessons learned)

⚠️ Only output files that ACTUALLY changed. If nothing is new, write "(no update needed)".`, 'Update Knowledge Base');
        (0, logger_1.log)(kbDelta);
        (0, file_utils_1.saveFile)(sessionDir, '09-kb-updates/kb-delta.md', `# KB Update Delta\n\n**Task:** ${requirement}\n**Date:** ${now}\n\n${kbDelta}`);
        // Parse and write automatically to KB files
        const kbUpdatePattern = /###\s*UPDATE:\s*([^\n]+)\n```[^\n]*\n([\s\S]*?)```/g;
        let kbMatch;
        const updatedFiles = [];
        while ((kbMatch = kbUpdatePattern.exec(kbDelta)) !== null) {
            const kbFilePath = kbMatch[1].trim();
            const kbContent = kbMatch[2].trim();
            const fullPath = path.join(workspaceRoot, kbFilePath);
            if (fs.existsSync(fullPath) && kbContent && kbContent !== '(no update needed)') {
                // APPEND delta to end of file — do not overwrite
                fs.appendFileSync(fullPath, `\n\n${kbContent}\n`, 'utf-8');
                updatedFiles.push(kbFilePath);
                (0, logger_1.log)(`✅ KB updated → ${kbFilePath}`);
            }
            else if (!fs.existsSync(fullPath)) {
                (0, logger_1.log)(`⚠  KB file does not exist, skipping: ${kbFilePath}`);
            }
        }
        if (updatedFiles.length === 0) {
            (0, logger_1.log)('ℹ  No KB files needed updating from this task');
        }
        else {
            (0, logger_1.log)(`✅ Updated ${updatedFiles.length} KB file(s): ${updatedFiles.join(', ')}`);
            vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
            vscode.window.showInformationMessage(`📚 Knowledge Base updated: ${updatedFiles.length} file(s)`, 'View KB Delta').then(sel => {
                if (sel === 'View KB Delta') {
                    const deltaPath = path.join(sessionDir, '09-kb-updates', 'kb-delta.md');
                    vscode.workspace.openTextDocument(deltaPath).then(d => vscode.window.showTextDocument(d, { preview: true }));
                }
            });
        }
    }
    else {
        (0, logger_1.log)('⏭  KB update skipped');
    }
    // Final message
    const msg = testResult.passed
        ? `🎉 DONE! ${status} | Coverage: ${covStr}`
        : testResult.skipped
            ? `✅ Workflow complete (tests skipped — configure testCommand)`
            : `❌ Tests failed — check Evidence for details`;
    const action = await vscode.window.showInformationMessage(msg, 'Open Session Folder');
    if (action === 'Open Session Folder') {
        vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(sessionDir));
    }
}
