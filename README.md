# 🚀 Auto Spec Kit — v1.5.3

> **Automate the full development workflow: Requirement → Plan → Code → Review → Test → Evidence**  
> Powered by **GitHub Copilot** (`vscode.lm` API) — no external API keys required.

Auto Spec Kit is a VS Code extension that turns a one-line task description into a complete, production-ready deliverable in a single command. It orchestrates GitHub Copilot through a structured 13-step pipeline — from planning to code generation, code review, test writing, and evidence collection — while keeping a growing Knowledge Base that makes every subsequent task smarter.

---

## 📋 Table of Contents

- [Why Auto Spec Kit?](#-why-auto-spec-kit)
- [Requirements](#-requirements)
- [Installation](#-installation)
- [Quick Start](#-quick-start)
- [Commands Overview](#-commands-overview)
- [Detailed Workflows](#-detailed-workflows)
  - [Run Task (13-Step Pipeline)](#1-run-task--13-step-pipeline)
  - [Generate Knowledge Base](#2-generate-knowledge-base)
  - [Review Current File](#3-review-current-file)
  - [Update Knowledge Base](#4-update-knowledge-base)
  - [Ask About Codebase](#5-ask-about-codebase)
  - [Generate User Stories (PO/BA)](#6-generate-user-stories-poba)
  - [Select Model](#7-select-model)
- [Keyboard Shortcuts](#-keyboard-shortcuts)
- [Configuration Reference](#-configuration-reference)
- [Knowledge Base](#-knowledge-base)
- [Session Outputs](#-session-outputs)
- [Review Skills System](#-review-skills-system)
- [Model Selection & Priority](#-model-selection--priority)
- [Git Context Integration](#-git-context-integration)
- [Supported Languages](#-supported-languages)
- [Tips & Best Practices](#-tips--best-practices)
- [Changelog](#-changelog)

---

## 💡 Why Auto Spec Kit?

Traditional AI coding assistants answer one question at a time. Auto Spec Kit runs a **complete, multi-step workflow** for each task:

| Without Auto Spec Kit | With Auto Spec Kit |
|---|---|
| Manually prompt Copilot for a plan | 13-step pipeline runs automatically |
| No code review | Two-phase review: quality + business consistency |
| No tests written | Test scaffolding generated for every task |
| No documentation | Evidence files saved with every session |
| AI has no project context | Knowledge Base grows with every task |

---

## 📦 Requirements

- **VS Code** `^1.90.0`
- **GitHub Copilot** subscription (individual or business)
- **GitHub Copilot Chat** extension installed and active
- Node.js (for local development / building from source)

> Auto Spec Kit uses the `vscode.lm` API to call GitHub Copilot directly inside VS Code — **no Anthropic, OpenAI, or other API keys needed**.

---

## 🔧 Installation

### From VSIX (recommended)

1. Download `auto-spec-kit-1.5.3.vsix`
2. Open VS Code → Extensions panel (`Ctrl+Shift+X`)
3. Click **⋯ → Install from VSIX…**
4. Select the downloaded file
5. Reload VS Code when prompted

### From Source

```bash
git clone <repo>
cd auto-spec-extension
npm install
npm run compile
npx @vscode/vsce package --no-dependencies --allow-missing-repository
# Install the generated .vsix from the Extensions panel
```

---

## ⚡ Quick Start

1. **Install** the extension (see above)
2. Open any project in VS Code
3. Press `Ctrl+Shift+B` (`Cmd+Shift+B` on Mac) → **Generate Knowledge Base**
   - Auto Spec Kit scans your project and generates 16 analysis files in `knowledge-base/`
4. Press `Ctrl+Shift+K` (`Cmd+Shift+K` on Mac) → **Run Task**
   - Describe what you want to build (e.g. `"Add email verification to user registration"`)
   - Watch the 13-step pipeline run in the Output panel
5. Review the generated files in `spec-kit-sessions/`

---

## 🎯 Commands Overview

| Command | Shortcut | Description |
|---|---|---|
| 🚀 **Run Task** | `Ctrl+Shift+K` | Full 13-step dev workflow for any task |
| 📚 **Generate Knowledge Base** | `Ctrl+Shift+B` | Analyze codebase → build 16-file KB |
| 🔍 **Review Current File** | *(right-click menu)* | Two-phase code review with fix suggestions |
| 📚 **Update Knowledge Base** | *(command palette)* | Merge changes from a completed task into KB |
| 💬 **Ask About Codebase** | *(command palette / explorer right-click)* | Natural language Q&A against KB |
| 📋 **Generate User Stories** | `Ctrl+Shift+U` | PO/BA workflow: Epic → Features → User Stories → HTML |
| 🤖 **Select Model** | *(command palette)* | Browse and choose GitHub Copilot model |

All commands are accessible via the **Command Palette** (`Ctrl+Shift+P` → type `Auto Spec Kit`).

---

## 📖 Detailed Workflows

### 1. Run Task — 13-Step Pipeline

**Shortcut:** `Ctrl+Shift+K` / `Cmd+Shift+K`

The core command. Give it a task description and it runs 13 sequential steps using GitHub Copilot:

| Step | Name | What it does |
|---|---|---|
| 01 | **Analysis** | Understands the requirement; checks if KB/files exist |
| 02 | **Task Plan** | Writes a detailed implementation plan |
| 03 | **Plan Review** | Reviews the plan for correctness and completeness |
| 04 | **Code Generation** | Generates all code changes / new files |
| 05 | **Code Review** | Two-phase review: quality checklist + business consistency |
| 06 | **Fix Issues** | Applies fixes found in the code review |
| 07 | **Tests** | Writes unit tests and integration tests |
| 08 | **Test Review** | Reviews test quality and coverage |
| 09 | **Fix Tests** | Applies test improvements |
| 10 | **Run Tests** | Executes `autoSpecKit.testCommand` and captures output |
| 11 | **Fix Failing Tests** | Diagnoses and fixes any test failures |
| 12 | **Evidence** | Builds final evidence document (plan, code, tests, results) |
| 13 | **Update KB** | Merges new learnings back into the Knowledge Base |

**After code generation (Step 04), you will be asked:**
- ✅ **Yes — Apply to project now** → files are written directly to your workspace
- 📁 **No — Save in session folder only** → files are saved to `spec-kit-sessions/<timestamp>/`

**After Update KB (Step 13), you will be asked:**
- ⭐ **Yes — Update KB with changes from this task** → KB files are updated
- ⏭ **No — Skip (not recommended)** → KB stays unchanged

All step outputs are saved to the session folder regardless of your choices.

---

### 2. Generate Knowledge Base

**Shortcut:** `Ctrl+Shift+B` / `Cmd+Shift+B`

Scans your entire project and generates a comprehensive Knowledge Base — 16 Markdown files covering every aspect of the codebase at **business depth** (not just technical description).

#### What gets analyzed

| File | Content |
|---|---|
| `01-project-overview.md` | Architecture, tech stack, project purpose |
| `02-tech-stack.md` | Libraries, frameworks, why each was chosen |
| `03-project-structure.md` | Folder layout, module boundaries, layer rules |
| `04-domain-model.md` | Core entities, relationships, domain concepts |
| `05-api-contracts.md` | REST/GraphQL endpoints, request/response shapes |
| `06-auth-security.md` | Auth flows, guards, permission model |
| `07-data-layer.md` | DB schema, migrations, ORM patterns |
| `08-integrations.md` | External services, queues, webhooks |
| `09-config-envvars.md` | Environment variables, feature flags, constants |
| `10-core-flows.md` | Key business workflows end-to-end |
| `11-error-handling.md` | Error types, HTTP codes, error propagation |
| `12-testing-strategy.md` | Test coverage, patterns, test data setup |
| `13-business-rules.md` | Business invariants, validations, constraints |
| `14-performance-scalability.md` | Bottlenecks, caching, scaling patterns |
| `15-tech-debt.md` | Known issues, TODOs, areas needing attention |
| `review-skills.md` | Project-specific rules merged with universal template |
| `_project-scan.md` | Raw file listing used during generation |

> **If a KB already exists**, you'll be asked to confirm overwrite before regenerating.

After generation, `review-skills.md` is opened automatically — this file is injected into every subsequent code review and task run.

---

### 3. Review Current File

**Access:** Right-click on any file in the editor → **Auto Spec Kit: Review Current File**  
Or via the Command Palette.

Performs a **two-phase, deep code review** on the currently open file:

**Phase 1 — Code Quality**  
Goes through every section in `review-skills.md` as a checklist:
- Security (injection, auth bypass, data exposure)
- Architecture (layer violations, coupling)
- Performance (N+1 queries, missing indexes, memory leaks)
- Error handling
- Code quality & naming
- Testability
- Type safety
- And all project-specific rules from Section 14

**Phase 2 — Business Consistency**  
Cross-references with the Knowledge Base:
- Does this code violate any business rule in `13-business-rules.md`?
- Has any important business logic been silently deleted?
- Are state transitions valid per the domain model?
- Is the API contract unchanged?

**Output format:**

```
## 📋 SECTION COVERAGE
| Section       | Status | Issues count |
|---------------|--------|-------------|
| Security      | ✅     | 0           |
| Architecture  | ⚠️     | 1           |
...

## 🏢 BUSINESS CONSISTENCY
| Check                  | Result | Notes |
|------------------------|--------|-------|
| Business rules intact  | ✅     |       |
...

## 🐛 ISSUES
### Issue #1 — [CRITICAL] · processOrder() · line ~45
> **Problem:** Missing input validation allows negative quantities.

**❌ Bad code (current):**
...

**✅ Fixed code (complete, no placeholders):**
...

## ✅ STRENGTHS (at least 3 points)

## 🎯 VERDICT: APPROVED / NEEDS_REVISION
## 📊 QUALITY SCORE: X/10 — reason
```

Review results open in a new panel beside the editor.

---

### 4. Update Knowledge Base

**Access:** Command Palette → `Auto Spec Kit: Update Knowledge Base`

Merges learnings from a completed task session back into the Knowledge Base. Useful when you complete a task manually (without using **Run Task**) and want to keep the KB current.

You will be prompted to describe what was added or changed in the session. Copilot then identifies which KB files are affected and applies targeted updates.

---

### 5. Ask About Codebase

**Access:** Command Palette → `Auto Spec Kit: Ask About Codebase`  
Or right-click any folder in the Explorer panel.

Natural language Q&A grounded in the Knowledge Base. Examples:

- *"How does order cancellation work?"*
- *"What validations exist for user registration?"*
- *"Which services call the payment gateway?"*
- *"What environment variables are required?"*
- *"What is the tech debt in the auth module?"*

Responses cite actual file paths and function names from the KB.

---

### 6. Generate User Stories (PO/BA)

**Shortcut:** `Ctrl+Shift+U` / `Cmd+Shift+U`

A dedicated PO/BA workflow that transforms an Epic description into a full structured backlog.

**Input (3 prompts):**
1. **Epic Title** — e.g. `"User Authentication & Authorization"`
2. **Epic Description** — business context, goals, constraints
3. **Feature List** — comma-separated list of features in scope

**4-step pipeline:**

| Step | Output |
|---|---|
| Investigation | Domain analysis: actors, business rules, edge cases, technical constraints |
| User Stories | Full story list with roles, actions, benefits, story points, priorities |
| Acceptance Criteria | Given/When/Then ACs + Definition of Done for each story |
| Sprint Planning | Stories grouped by sprint, sequenced by dependency and risk |

**Output:**
- **JSON file** (`epic-<title>-<timestamp>.json`) — structured `EpicOutput` schema with all epics, features, stories, and ACs
- **Interactive HTML report** (`epic-<title>-<timestamp>.html`) — sprint board with:
  - Sprint columns with collapsible story cards
  - Priority filters (P1 / P2 / P3)
  - Role filter and sprint filter
  - Expandable cards showing ACs (Given/When/Then), Definition of Done, dependencies, technical notes, API endpoints
  - Print/export to PDF support

Story format in the HTML:
> *As **[role]**, I want to **[action]** so that **[benefit]**.*

Both files are saved to `spec-kit-sessions/<timestamp>/` and opened automatically on completion.

---

### 7. Select Model

**Access:** Command Palette → `Auto Spec Kit: Select Model`

Browse all available GitHub Copilot language models and select your preferred one. The selection is saved to `autoSpecKit.model` in VS Code settings and used for all subsequent commands.

Models are sorted by quality (best first) using a built-in priority ranking. The currently active model is marked with `← current`.

---

## ⌨️ Keyboard Shortcuts

| Action | Windows / Linux | macOS |
|---|---|---|
| Run Task (13-step pipeline) | `Ctrl+Shift+K` | `Cmd+Shift+K` |
| Generate Knowledge Base | `Ctrl+Shift+B` | `Cmd+Shift+B` |
| Generate User Stories | `Ctrl+Shift+U` | `Cmd+Shift+U` |

All other commands are accessible via the Command Palette (`Ctrl+Shift+P` → `Auto Spec Kit`).

---

## ⚙️ Configuration Reference

Open VS Code Settings (`Ctrl+,`) and search for **Auto Spec Kit**, or edit `settings.json` directly:

```jsonc
{
  // Command to run your test suite.
  // Output is captured and analyzed by Copilot in Step 10 (Run Tests).
  // Leave blank to skip the test-run step.
  // Examples:
  //   "npx jest --coverage --coverageReporters=text 2>&1"
  //   "npm test 2>&1"
  //   "python -m pytest --tb=short 2>&1"
  "autoSpecKit.testCommand": "",

  // Primary programming language of the project.
  // Used to guide code generation style and test framework choices.
  // Options: "typescript" | "javascript" | "python" | "java" | "go"
  "autoSpecKit.language": "typescript",

  // Relative path (from workspace root) to the Knowledge Base folder.
  // Default creates a `knowledge-base/` directory at the project root.
  "autoSpecKit.knowledgeBasePath": "knowledge-base",

  // When true, generated code is automatically written to the project
  // without showing the apply/skip prompt.
  "autoSpecKit.autoApplyCode": false,

  // Folder where session outputs (plans, code, reviews, evidence) are saved.
  // Relative to workspace root.
  "autoSpecKit.sessionsDir": "spec-kit-sessions",

  // Preferred Copilot model ID. Leave blank for auto-selection (best available).
  // Run "Auto Spec Kit: Select Model" to browse all options.
  // Examples: "gpt-5.5", "gpt-5.4", "claude-opus-4-7", "claude-sonnet-4-6",
  //           "gemini-2.5-pro", "o3", "o4-mini"
  "autoSpecKit.model": "",

  // When true, shows the model Quick Pick at the start of every command run,
  // ignoring the saved autoSpecKit.model value.
  "autoSpecKit.askModelOnStart": false
}
```

### Recommended setup

```jsonc
{
  "autoSpecKit.language": "typescript",
  "autoSpecKit.testCommand": "npx jest --coverage --coverageReporters=text 2>&1",
  "autoSpecKit.model": "gpt-5.5",
  "autoSpecKit.autoApplyCode": false
}
```

---

## 🧠 Knowledge Base

The Knowledge Base is the foundation of Auto Spec Kit. It is a folder of Markdown files (`knowledge-base/` by default) that:

1. **Powers code generation** — Copilot knows the exact architecture, patterns, and business rules before writing new code
2. **Powers code review** — every review cross-references business rules and domain constraints
3. **Powers Q&A** — the Ask command answers questions grounded in actual codebase evidence
4. **Powers planning** — task plans reference existing flows and avoid duplicate implementations
5. **Gets smarter over time** — every completed task updates the KB automatically

### Generating the KB for the first time

```
Ctrl+Shift+B  →  Wait ~3–10 minutes (depends on project size and model)
```

### Keeping the KB current

The **Run Task** pipeline automatically offers to update the KB at Step 13. For manual tasks, use **Update Knowledge Base** from the Command Palette.

### KB directory structure

```
knowledge-base/
├── 01-project-overview.md
├── 02-tech-stack.md
├── 03-project-structure.md
├── 04-domain-model.md
├── 05-api-contracts.md
├── 06-auth-security.md
├── 07-data-layer.md
├── 08-integrations.md
├── 09-config-envvars.md
├── 10-core-flows.md
├── 11-error-handling.md
├── 12-testing-strategy.md
├── 13-business-rules.md       ← most important for code review
├── 14-performance-scalability.md
├── 15-tech-debt.md
├── review-skills.md           ← injected into every code review
└── _project-scan.md           ← raw scan (for debugging)
```

> **Tip:** Commit `review-skills.md` to share project review standards with your team.  
> Add the rest of `knowledge-base/` to `.gitignore` if you prefer not to commit auto-generated analysis files.

---

## 📁 Session Outputs

Every command run produces a timestamped session folder under `spec-kit-sessions/`:

```
spec-kit-sessions/
└── 2026-05-25T14-30-00/
    ├── 01-analysis.md
    ├── 02-task-plan.md
    ├── 03-plan-review.md
    ├── 04-code-gen.md          ← or actual .ts/.py files if applied to project
    ├── 05-code-review.md
    ├── 06-fix-issues.md
    ├── 07-tests.md
    ├── 08-test-review.md
    ├── 09-fix-tests.md
    ├── 10-test-results.md
    ├── 11-fix-failing.md
    ├── 12-evidence.md
    └── 13-kb-delta.md
```

For User Stories, outputs look like:

```
spec-kit-sessions/
└── 2026-05-25T14-45-00/
    ├── epic-user-auth-2026-05-25T14-45-00.json
    └── epic-user-auth-2026-05-25T14-45-00.html
```

---

## 🛡️ Review Skills System

The review skill system has two layers that are merged into a single `review-skills.md` file.

### Universal Template (`resources/review-skills-universal.md`)

Bundled with the extension. Contains 13 sections of review rules applicable to any project:

1. Security
2. Architecture & Design
3. Performance
4. Error Handling
5. Code Quality & Readability
6. Type Safety
7. Testability
8. API Design
9. Database & Data Layer
10. Documentation
11. Observability & Logging
12. DevOps & Deployment
13. Business Logic

### Section 14 — Project-Specific Rules

Generated by Copilot during **Generate Knowledge Base**. Contains rules unique to _your_ project:
- Naming conventions
- Mandatory patterns and conventions
- Banned anti-patterns
- Business rules to enforce in every new feature
- Project-specific technology usage

**Priority:** Section 14 (project-specific) takes highest priority over universal rules.

### Load order for reviews

When reviewing a file or running a task, review skills are loaded in this order:
1. **`knowledge-base/review-skills.md`** — preferred (universal rules + project Section 14)
2. **`resources/review-skills-universal.md`** — fallback if no KB exists
3. **Generic checklist** — last resort if neither file is found

---

## 🤖 Model Selection & Priority

Auto Spec Kit ranks available GitHub Copilot models and auto-selects the best one. Built-in priority (2026):

| Priority | Model ID |
|---|---|
| 1 (best) | `gpt-5.5` |
| 2 | `gpt-5.4` |
| 3 | `claude-opus-4-7` |
| 4 | `o3` |
| 5 | `claude-sonnet-4-6` |
| 6 | `gemini-2.5-pro` |
| 7 | `gpt-5` |
| 8 | `o4-mini` |
| ... | *(other models sorted alphabetically)* |

**To override auto-selection:**
- Run **Select Model** from the Command Palette, or
- Set `"autoSpecKit.model": "gpt-5.5"` in settings directly, or
- Enable `"autoSpecKit.askModelOnStart": true` to choose on every run

---

## 🔀 Git Context Integration

The **Run Task** Step 05 (Code Review) and **Review Current File** both automatically load git context:

- **Diff vs. default branch** — all changes since branching off `main`/`master`/`develop`
- **Working tree diff** — uncommitted local changes
- **Recent commit messages** — provides intent context for the reviewer

This means Copilot reviews _what changed_, not just the file in isolation — catching regressions, unintended deletions, and API contract breaks.

---

## 💻 Supported Languages

Configure `autoSpecKit.language` to tune code generation:

| Language | Test Framework Hints | Code Style |
|---|---|---|
| `typescript` | Jest / Vitest | ES modules, strict types |
| `javascript` | Jest / Mocha | CommonJS or ESM |
| `python` | pytest | PEP 8 |
| `java` | JUnit 5 / Mockito | Maven/Gradle conventions |
| `go` | `testing` package | Go idioms |

---

## 💡 Tips & Best Practices

### Getting the best results from Run Task

- **Be specific.** Instead of *"add auth"*, write *"Add JWT-based email/password authentication with refresh tokens, bcrypt password hashing, and rate limiting on the login endpoint."*
- **Generate KB first.** The pipeline is significantly more accurate when it can reference your actual codebase architecture.
- **Set `autoSpecKit.testCommand`** so Step 10 runs your real tests and Step 11 can fix actual failures.
- **Read Step 05 output carefully.** The two-phase review often surfaces issues a manual review would miss.

### Knowledge Base tips

- Re-run **Generate KB** after major refactors or architecture changes.
- The most valuable KB file is `13-business-rules.md` — the more accurate it is, the better every review becomes.
- Commit `review-skills.md` to share your project's review standards with the entire team.

### User Stories tips

- Provide a detailed Epic Description including non-functional requirements and explicit out-of-scope items.
- 5–10 features per epic produces the most useful story granularity.
- The generated HTML can be printed as a PDF for stakeholder review sessions.

### Model tips

- For **complex tasks or large files**, use `gpt-5.5` or `claude-opus-4-7` for deepest analysis.
- For **fast iterations**, `o4-mini` or `claude-sonnet-4-6` are noticeably faster.
- KB generation is the most token-intensive operation — use the best model available for it.

---

## 📝 Changelog

### v1.5.3 (current)
- ✅ Added **Generate User Stories (PO/BA)** command (`Ctrl+Shift+U`)
- ✅ Interactive HTML sprint board with priority/role/sprint filters
- ✅ Structured JSON output (`EpicOutput` schema) for integration with PM tools
- ✅ Given/When/Then acceptance criteria format
- ✅ Story cards: *As [role], I want to [action] so that [benefit]*
- ✅ Git diff context integrated into Run Task Step 05 and Review Current File
- ✅ All UI, prompts, and generated output in English

### v1.5.0
- ✅ Expanded KB from 12 to 15 analysis steps
- ✅ Business-depth KB prompts — cites actual file paths and function names as evidence
- ✅ Added `13-business-rules.md`, `14-performance-scalability.md`, `15-tech-debt.md`
- ✅ Updated model priority list for 2026 GitHub Copilot models

### v1.4.1
- ✅ Model selection UI with quality ranking
- ✅ `autoSpecKit.model` and `autoSpecKit.askModelOnStart` settings
- ✅ **Select Model** command

### v1.3.0
- ✅ **Review Current File** command (standalone two-phase review)
- ✅ Universal review skills template (`resources/review-skills-universal.md`)
- ✅ Section 14 project-specific rules merged during KB generation
- ✅ **Update Knowledge Base** command

### v1.2.0
- ✅ **Generate Knowledge Base** command (15-file structure)
- ✅ **Ask About Codebase** command
- ✅ KB referenced in all Run Task steps

### v1.1.0
- ✅ **Run Task** 13-step pipeline
- ✅ Session output folder with all step outputs
- ✅ Apply-to-project vs. save-to-session choice

### v1.0.0
- ✅ Initial release

---

## 📄 License

MIT

---

*Built with the `vscode.lm` API — requires GitHub Copilot, no additional API keys needed.*
