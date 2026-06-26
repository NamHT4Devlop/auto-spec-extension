# 🚀 Auto Spec Kit — v1.13.0

> **Automate the full development workflow: Requirement → Plan → Code → Review → Test → Evidence**  
> Powered by **GitHub Copilot** (`vscode.lm` API) — no external API keys required.

Auto Spec Kit is a VS Code extension that turns a one-line task description into a complete, production-ready deliverable in a single command. It orchestrates GitHub Copilot through a structured 13-step pipeline — from planning to code generation, code review, test writing, and evidence collection — while keeping a growing Knowledge Base that makes every subsequent task smarter.

---

## 📋 Table of Contents

- [Why Auto Spec Kit?](#-why-auto-spec-kit)
- [Requirements](#-requirements)
- [Installation](#-installation)
- [Quick Start](#-quick-start)
- [Usage — Copilot Chat (`@protector_spec`)](#-usage--copilot-chat-autospec)
- [Usage — Command Palette](#-usage--command-palette)
- [Deep Dive: `/build` — 13-Step Pipeline](#-deep-dive-build--13-step-pipeline)
- [Detailed Workflows](#-detailed-workflows)
  - [Scan Project (Knowledge Base)](#1-scan-project-knowledge-base)
  - [Review Current File](#2-review-current-file)
  - [Rescan Latest Changes](#3-rescan-latest-changes)
  - [Ask About Codebase](#4-ask-about-codebase)
  - [Plan User Stories (PO/BA)](#5-plan-user-stories-poba)
  - [Map Codebase (Dependency Graph)](#6-map-codebase-dependency-graph)
  - [Select Model](#8-select-model)
- [Multi-Agent Architecture (v1.7.0)](#-multi-agent-architecture-v170)
- [Adaptive Intelligence (v1.8.0)](#-adaptive-intelligence-v180)
- [Deep KB & Module Awareness (v1.9.0)](#-deep-kb--module-awareness-v190)
- [Architecture Protection (v1.10.0)](#-architecture-protection-v100)
- [Token Safety & Idle Guard (v1.11.x)](#-token-safety--idle-guard-v111x)
- [Keyboard Shortcuts](#-keyboard-shortcuts)
- [Configuration Reference](#-configuration-reference)
- [Knowledge Base](#-knowledge-base)
- [Session Outputs](#-session-outputs)
- [Review Skills System](#-review-skills-system)
- [Model Selection & Priority](#-model-selection--priority)
- [Git Context Integration](#-git-context-integration)
- [Git Auto-Sync (GitSyncGuard)](#-git-auto-sync-gitsyncguard)
- [Supported Languages](#-supported-languages)
- [Tips & Best Practices](#-tips--best-practices)
- [Changelog](#-changelog)

---

## 💡 Why Auto Spec Kit?

Traditional AI coding assistants answer one question at a time. Auto Spec Kit runs a **complete, multi-step workflow** for each task:

| Without Auto Spec Kit | With Auto Spec Kit |
|---|---|
| Manually prompt Copilot for a plan | 13-step pipeline runs automatically |
| No code review | Multi-agent review: security + architecture + performance + business |
| No tests written | Test scaffolding generated for every task |
| No documentation | Evidence files saved with every session |
| AI has no project context | Knowledge Base grows with every task |
| Single AI perspective | Multiple parallel sub-agents for deeper analysis |

---

## 📦 Requirements

- **VS Code** `^1.93.0`
- **GitHub Copilot** subscription (individual or business)
- **GitHub Copilot Chat** extension installed and active
- Node.js (for local development / building from source)

> Auto Spec Kit uses the `vscode.lm` API to call GitHub Copilot directly inside VS Code — **no Anthropic, OpenAI, or other API keys needed**.

---

## 🔧 Installation

### From VSIX (recommended)

1. Download `auto-spec-kit-1.13.0.vsix`
2. Open VS Code → Extensions panel (`Ctrl+Shift+X`)
3. Click **⋯ → Install from VSIX…**
4. Select the downloaded file
5. Reload VS Code when prompted

### From Source

```bash
git clone <your-repo-url>
cd auto-spec-extension
yarn install
yarn compile
yarn package
# Install the generated .vsix:
code --install-extension auto-spec-kit-1.13.0.vsix
```

---

## ⚡ Quick Start

1. **Install** the extension (see above)
2. Open any project in VS Code
3. Open **Copilot Chat** panel → type `@protector_spec /scan` → Scan project & generate Knowledge Base
4. Then type `@protector_spec /build Add email verification to user registration`
5. Watch the 13-step multi-agent pipeline run

Or use keyboard shortcuts: `Cmd+Shift+B` (Scan), `Cmd+Shift+K` (Build).

---

## 🤖 Usage — Copilot Chat (`@protector_spec`)

**This is the primary way to use Auto Spec Kit.** Open the Copilot Chat panel in VS Code and type:

| Command | What it does |
|---|---|
| `@protector_spec /build Add reset password feature` | Build a feature — full 13-step pipeline |
| `@protector_spec /scan` | Scan the project — generate Knowledge Base |
| `@protector_spec /rescan` | Rescan latest changes — update Knowledge Base |
| `@protector_spec /review` | Review current file — security, architecture, performance |
| `@protector_spec /ask How does auth work?` | Ask about codebase — Q&A + Mermaid diagram (BA-friendly) |
| `@protector_spec /plan User onboarding redesign...` | Plan user stories — Epic → Sprint Plan (PO/BA) |
| `@protector_spec /map` | Map the codebase — interactive dependency graph |
| `@protector_spec /document Order checkout flow` | Investigate & document — business ↔ code mapping, exports HTML |

### Free text (no slash command)

```
@protector_spec Which module handles payment processing?
```

If you don't use a slash command, your message is treated as `/ask` — a question about the codebase answered from the Knowledge Base.

### How it works

When you type `@protector_spec`, VS Code routes your message to the Auto Spec Kit **Chat Participant**. The extension:

1. Reads your slash command (e.g., `/build`, `/scan`, `/review`)
2. Resolves the best available Copilot model
3. Runs the corresponding workflow (with multi-agent orchestration where applicable)
4. Streams progress and results directly into the chat panel
5. Saves full outputs to `spec-kit-sessions/` and/or `knowledge-base/`

### Example session

```
You:     @protector_spec /scan
Bot:     📚 Generating Knowledge Base...
         Analyzing your codebase with multi-agent batch parallelism...
         ✅ Knowledge Base generated! Check knowledge-base/ folder.

You:     @protector_spec /build Add reset password feature using email OTP, expires after 10 minutes
Bot:     🚀 Auto Spec Kit — Dev Workflow
         Requirement: Add reset password feature using email OTP...
         [Step 01/13] Planning with 3 parallel agents...
         [Step 02/13] Plan review...
         ...
         ✅ Pipeline completed! Check spec-kit-sessions/ for full details.

You:     @protector_spec /review
Bot:     🔍 Reviewing: src/services/auth.service.ts
         ✅ Review complete! Check Output panel for findings.

You:     @protector_spec What API endpoints require authentication?
Bot:     💬 Searching Knowledge Base...
         ✅ Check Output panel for the full answer.
```

---

## 🎮 Usage — Command Palette

All commands are also available via **Command Palette** (`Ctrl+Shift+P` → type `Auto Spec Kit`):

| Command | Shortcut | Description |
|---|---|---|
| 🚀 **Build Feature** | `Ctrl+Shift+K` | Full 13-step dev pipeline |
| 📚 **Scan Project** | `Ctrl+Shift+B` | Analyze codebase → generate KB |
| 🔍 **Review Current File** | *(right-click menu)* | Multi-agent code review |
| 📚 **Rescan Latest Changes** | *(command palette)* | Update KB with new code |
| 💬 **Ask About Codebase** | *(command palette / explorer right-click)* | Natural language Q&A + Mermaid diagram |
| 📋 **Plan User Stories** | `Ctrl+Shift+U` | PO/BA: Epic → Stories → Sprint Plan |
| 🔭 **Map Codebase** | *(command palette)* | D3.js interactive dependency graph |
| 📄 **Document Feature/Entity** | *(Copilot Chat `/document`)* | Business ↔ code mapping, exports HTML |
| 🤖 **Select Model** | *(command palette)* | Choose GitHub Copilot model |

---

## 🔬 Deep Dive: `/build` — 13-Step Pipeline

When you type `@protector_spec /build Add reset password feature using email OTP, expires after 10 minutes`, this is exactly what happens:

### Input

You provide **one line** — a task description. The extension handles everything else.

### Pipeline Steps

```
Step 01  Planning ─────────────── 3 parallel agents analyze your codebase
Step 02  Plan Review ──────────── 2 agents validate feasibility + business alignment
Step 03  Plan Feedback ────────── ⏸ YOU review the plan, add comments
Step 04  Code Generation ──────── N parallel generators (one per module)
Step 05  Code Review ──────────── 4 agents: Security + Architecture + Performance + Business
Step 06  Code Feedback ────────── ⏸ YOU review the code, request changes
Step 07  Write Tests ──────────── 3 agents: Unit + Integration + Edge Case
Step 08  Test Review ──────────── 2 agents: Coverage + Quality
Step 09  Test Feedback ────────── ⏸ YOU review tests, add comments
Step 10  Save & Apply ─────────── Extract files, write to project
Step 11  Execute Tests ────────── Run your test command, capture results
Step 12  Evidence Collection ──── 2 agents: Technical + Business evidence
Step 13  Update KB ────────────── 2 agents: Technical Delta + Business Delta
```

### Step-by-step detail

**Step 01 — Planning (3 agents in parallel)**

Your requirement triggers 3 sub-agents that run simultaneously:

| Agent | Role | What it does |
|---|---|---|
| Codebase Analyzer | Scans project via SmartContextLoader | Discovers which files, classes, and modules are relevant to the task |
| Impact Detector | Traces dependencies | Identifies all files that will be affected by the change (direct + transitive) |
| Business Flow Tracer | Reads Knowledge Base | Maps existing business flows that interact with the change area |

A **merge agent** then combines the 3 outputs into a unified implementation plan.

**Example for "Add reset password feature":**
- Codebase Analyzer → finds `auth.service.ts`, `user.repository.ts`, `email.service.ts`, existing password change flow
- Impact Detector → identifies `auth.controller.ts` needs new endpoint, `user.entity.ts` needs OTP fields, `auth.module.ts` needs new provider
- Business Flow Tracer → maps existing login flow, token refresh flow, identifies where reset intersects

**Step 02 — Plan Review (2 agents)**

| Agent | Focus |
|---|---|
| Technical Feasibility | Can this plan actually be implemented? Are there dependency conflicts? Missing prerequisites? |
| Business Alignment | Does the plan match the requirement? Are there business rules being violated? |

**Step 03 — Plan Feedback (human checkpoint)**

The pipeline pauses and shows you the plan. You can:
- ✅ Approve and continue
- ✏️ Add comments ("also add rate limiting on the OTP endpoint")
- ❌ Cancel the pipeline

**Step 04 — Code Generation (N parallel generators)**

The plan is split into **work units** — one per module/file. Each work unit gets its own code generator agent running in parallel:

```
Work Unit 1: auth.controller.ts  → Agent generates POST /reset-password, POST /verify-otp
Work Unit 2: auth.service.ts     → Agent generates resetPassword(), verifyOtp(), generateOtp()
Work Unit 3: user.entity.ts      → Agent adds otpCode, otpExpiresAt fields
Work Unit 4: email.service.ts    → Agent generates sendOtpEmail()
Work Unit 5: auth.module.ts      → Agent wires new providers
```

All agents share the same context (plan + KB + relevant source files) but generate code independently.

**Step 05 — Code Review (4 agents in parallel)**

The generated code is reviewed by 4 specialized agents simultaneously:

| Agent | Checks |
|---|---|
| 🔒 Security | SQL injection, XSS, auth bypass, OTP brute-force protection, timing attacks |
| 🏗 Architecture | Layer violations, coupling, DI patterns, SOLID principles |
| ⚡ Performance | N+1 queries, missing indexes, memory leaks, unnecessary allocations |
| 🏢 Business Consistency | Cross-references `13-business-rules.md` — validates domain rules intact |

**Step 06 — Code Feedback (human checkpoint)**

Pipeline pauses. You review the generated code + review findings. Approve, request fixes, or cancel.

**Step 07 — Write Tests (3 agents in parallel)**

| Agent | Generates |
|---|---|
| Unit Tests | Tests for each function/method in isolation, mocking dependencies |
| Integration Tests | Tests for API endpoints, database interactions, service-to-service calls |
| Edge Case / Security | Boundary values, expired OTP, invalid tokens, brute-force scenarios |

**Step 08 — Test Review (2 agents)**

| Agent | Focus |
|---|---|
| Coverage Analyzer | Are all code paths covered? Missing branches? Uncovered error handlers? |
| Quality Reviewer | Are tests maintainable? Proper assertions? No false positives? |

**Step 09 — Test Feedback (human checkpoint)**

Review tests. Approve or request changes.

**Step 10 — Save & Apply**

Files are extracted from generated markdown and written to your project. You choose:
- ✅ Apply to project now → files written to workspace
- 📁 Save in session folder only → non-destructive

**Step 11 — Execute Tests**

Runs your configured `autoSpecKit.testCommand` (e.g., `npx jest --coverage`). Captures stdout, stderr, exit code. If tests fail, Copilot analyzes failures and suggests fixes.

**Step 12 — Evidence Collection (2 agents)**

| Agent | Produces |
|---|---|
| Technical Evidence | Summary of all code changes, architecture decisions, test results |
| Business Evidence | How the change affects business flows, what was validated, risk assessment |

Saved as `evidence.md` in the session folder — ready for code review, sprint review, or audit.

**Step 13 — Rescan & Update Knowledge Base (2 agents)**

| Agent | Updates |
|---|---|
| Technical Delta | Updates architecture, API contracts, tech stack KB files with new information |
| Business Delta | Updates business rules, core flows, domain model KB files |

This is how the KB **gets smarter over time** — each completed task enriches the knowledge for future tasks.

### Output

After the pipeline completes, your session folder contains:

```
spec-kit-sessions/2026-06-10T14-30-00/
├── plan.md              ← Implementation plan
├── plan-review.md       ← Plan validation results
├── code.md              ← Generated code (all files)
├── code-review.md       ← 4-agent review results
├── tests.md             ← Generated tests
├── test-review.md       ← Test quality assessment
├── test-results.md      ← Actual test execution output
├── evidence.md          ← Technical + business evidence
└── kb-delta.md          ← KB update patches applied
```

---

## 📖 Detailed Workflows

### 1. Scan Project (Knowledge Base)

**Chat:** `@protector_spec /scan` | **Shortcut:** `Ctrl+Shift+B` / `Cmd+Shift+B`

Scans your entire project and generates a comprehensive Knowledge Base — 15 Markdown files covering every aspect of the codebase at **business depth**.

Uses **batch parallelism** (5 batches × 3 parallel agents). Critical business steps get additional sub-agents for deeper analysis.

**Source-only mode:** If a KB already exists, `/scan` offers a QuickPick choice — rebuild from source code only (skips README, CONTRIBUTING, CHANGELOG, `docs/`, `.github/`, etc.) or regenerate with docs included. Useful when existing documentation is outdated. See [Source-Only KB Scan Mode](#source-only-kb-scan-mode) for details.

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

---

### 2. Review Current File

**Chat:** `@protector_spec /review` | **Access:** Right-click → **Auto Spec Kit: Review Current File**

Multi-agent code review with 4 parallel reviewers (Security, Architecture, Performance, Business Consistency). Cross-references your Knowledge Base for business rule validation.

---

### 3. Rescan Latest Changes

**Chat:** `@protector_spec /rescan` | **Access:** Command Palette

Merges learnings from manual work back into the KB. Useful when you complete tasks outside the `/build` pipeline.

---

### 4. Ask About Codebase

**Chat:** `@protector_spec /ask <question>` or just `@protector_spec <question>`

Natural language Q&A grounded in the Knowledge Base. Each answer includes:
- **Technical explanation** — code-level detail
- **Business explanation** — BA/product-friendly summary (no jargon)
- **Mermaid diagram** — flowchart, sequence diagram, or ER diagram auto-selected by question type (v1.12.0)

Examples:
- `@protector_spec /ask How does order cancellation work?`
- `@protector_spec Which services call the payment gateway?`
- `@protector_spec What environment variables are required?`

---

### 5. Plan User Stories (PO/BA)

**Chat:** `@protector_spec /plan <epic description>` | **Shortcut:** `Ctrl+Shift+U`

A 7-step AI pipeline for PO/BA that requires only 2 inputs (Epic title + description):

| Step | What happens |
|---|---|
| 1. KB Investigation | 3 agents scan KB for domain context, existing flows, constraints |
| 2. Feature Discovery | AI auto-discovers features from epic description + KB context |
| 3. Impact Analysis | Per-feature: maps old business flow vs. new flow |
| 4. Confirmation Checklist | Generates questions to confirm with stakeholders |
| 5. User Story Generation | Per-feature parallel story writing |
| 6. Sprint Planning | Groups stories into sprints by dependency and priority |
| 7. HTML Report | Interactive sprint board with filters |

**Example:**
```
@protector_spec /plan User Onboarding Redesign: Simplify registration, add social login 
(Google, GitHub), implement email verification with OTP, create guided setup wizard.
```

---

### 6. Map Codebase (Dependency Graph)

**Chat:** `@protector_spec /map` | **Access:** Command Palette

Generates an interactive D3.js force-directed graph of your project. Supports **9 programming languages** (TypeScript, JavaScript, Python, Java, Go, Ruby, C#, PHP, Rust).

Two phases:
1. **Static scan** — file imports, class hierarchy, method calls, API routes, decorators, DI wiring
2. **AI enrichment** (optional) — 3 agents: Flow Tracer, Entity Mapper, Architecture Validator

**What the graph shows (v1.13.0):**

| Node type | Languages |
|---|---|
| `class` | All 9 languages |
| `interface` | TypeScript, Java, Go, C#, PHP + Rust traits |
| `enum` | TypeScript, Java, C#, PHP, Rust |
| `controller / service / repository` | Spring, NestJS, Laravel, etc. |
| `route` | Express, FastAPI, Rails, Spring MVC |

**Edges:**
- `imports` — file-level dependencies
- `extends / implements` — class hierarchy
- `injects` — DI field injection (Spring `@Autowired`, NestJS constructor injection, Go struct fields, Rust `Arc<T>`, PHP typed properties)
- `calls` — method call cross-references (DI-guided — prefers known injected deps)

Click any node in the graph → opens the source file in VS Code.

---

### 7. Document Feature / Entity (new in v1.11.0)

**Chat:** `@protector_spec /document <topic>`

Produces a precise technical document that maps **business concepts ↔ code** at the field level, grounded in the Knowledge Base and real source code.

```
@protector_spec /document Order checkout flow
@protector_spec /document User entity (field-level mapping)
@protector_spec /document Payment gateway integration
```

**Output:**
- A structured Markdown document (field-by-field, method-by-method)
- A self-contained **HTML file** opened in a webview (and saved to `spec-kit-sessions/`)
- Non-technical section (BA-friendly summary) + technical section (code references, data contracts)

---

### 8. Select Model

**Chat:** N/A | **Access:** Command Palette → `Auto Spec Kit: Select Model`

Browse available GitHub Copilot models. Selection saved to settings.

---

## 🧠 Multi-Agent Architecture (v1.7.0)

v1.7.0 introduces **parallel sub-agents** for deeper analysis. Instead of one Copilot call per step, critical steps spawn multiple specialized agents that work simultaneously.

### Core infrastructure

| Component | Purpose |
|---|---|
| `AgentOrchestrator` | Runs N agents in parallel with concurrency control, timeout, and 3 merge strategies |
| `SmartContextLoader` | File Discovery Agent selects relevant files; builds per-agent token-budgeted context |
| `TokenBudget` | Estimates tokens, allocates budget by priority, auto-truncates to fit model limits |

### Merge strategies

| Strategy | How it works | Best for |
|---|---|---|
| `ai` | A merge agent synthesizes all outputs into one coherent document | Planning, evidence |
| `concat` | Simple concatenation with headers | Code generation, tests |
| `structured` | Section-based merge with deduplication | Reviews, KB updates |

### Configuration

```jsonc
{
  "autoSpecKit.agents.maxParallel": 3,        // 1-6 parallel agents per step
  "autoSpecKit.agents.timeout": 90000,         // Per-agent timeout (ms)
  "autoSpecKit.agents.mergeStrategy": "ai",    // ai | concat | structured
  "autoSpecKit.agents.contextStrategy": "smart" // smart | full | minimal
}
```

---

## 🧠 Adaptive Intelligence (v1.8.0)

v1.8.0 introduces 5 systems that make Auto Spec Kit smarter over time and work across any project structure.

### `/help` — Context-Aware Status

`@protector_spec /help` now shows a live dashboard: KB status, model info, project profile, learnings count, workspace type, and `.autospec.yml` detection — all at a glance.

### SessionMemory — No Context Lost

Long chat sessions in Copilot truncate early messages. `SessionMemory` persists key decisions, milestones, and the original requirement in `workspaceState`, injecting a rolling summary into every prompt. Auto-compacts at 30 entries to stay within token budget.

### RequirementClarifier — Handle Vague Inputs

Before running the 13-step pipeline, the `RequirementClarifier` scores your requirement across 4 dimensions (Specificity, Scope, Acceptance, Technical — 0-25 each). If the score is below 60, it asks targeted clarifying questions. In chat mode, questions appear inline; in Command Palette mode, via Quick Pick dialogs.

### ProjectProfile + LearningStore — Gets Smarter Over Time

`ProjectProfileDetector` auto-detects your stack (language, framework, build tool, test framework, linter, formatter, database, CI/CD, monorepo tool) by scanning project files. Cached in `.autospec/profile.json` for 24 hours.

`LearningStore` persists patterns from past sessions (code review fixes, test patterns, user preferences, conventions, architecture decisions, things to avoid) in `.autospec/learnings.json`. Duplicate learnings are reinforced (count incremented), and the top learnings are injected into every prompt — so the agent avoids past mistakes and follows your conventions.

### WorkspaceResolver — Any Repo Structure

Handles 4 workspace scenarios automatically:

| Scenario | Behavior |
|---|---|
| Single repo | Uses directly |
| Multi-root workspace | Shows picker to select folder |
| Monorepo (Nx, Turbo, Lerna, pnpm) | Detects packages, lets you scope to one |
| Folder of repos | Auto-discovers, shows picker |

### GitSyncGuard — Auto-Fetch/Pull Before Every Command

Before every command (except `/help`), the extension automatically syncs your workspace with the remote:

1. Runs `git fetch --all --prune`
2. Runs `git pull --ff-only` (fast-forward only — never creates merge commits)
3. Detects if source files changed after pull
4. If KB exists and source files changed, auto-runs KB update (via `updateKBStandalone`)

**Safety guarantees:**
- **NEVER** pushes, commits, or writes to the git remote — strictly read-only
- **Non-fatal** — sync failures do not block commands (works offline, works on non-git projects)

Configure via VS Code settings or `.autospec.yml`:

```jsonc
{
  "autoSpecKit.autoSync": true,          // enable/disable auto-fetch/pull
  "autoSpecKit.autoSyncKBUpdate": true   // auto-update KB when pulled code has source changes
}
```

### Source-Only KB Scan Mode

When scanning a project, you can choose to exclude existing documentation and generate the Knowledge Base purely from source code. This is useful when existing docs (README, CONTRIBUTING, CHANGELOG, etc.) are outdated or misleading.

When a KB already exists, `/scan` presents a QuickPick:
- **Fresh rebuild — source code only** — excludes doc files/dirs, generates KB from code alone
- **Regenerate KB (include existing docs)** — standard full scan

Excluded in source-only mode:
- Files: `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `LICENSE.md`, `SECURITY.md`, `copilot-instructions.md`, etc.
- Directories: `docs/`, `doc/`, `.github/`, `.gitlab/`, `wiki/`
- Extensions: `.md`, `.mdx`, `.rst`, `.adoc`

Configure additional exclusions in `.autospec.yml`:

```yaml
scan:
  excludeDocs: true
  exclude:
    - "generated"
    - "vendor"
```

### `.autospec.yml` — Per-Project Config

Drop a `.autospec.yml` in your project root to override settings without touching VS Code config:

```yaml
language: java
testCommand: mvn test
knowledgeBasePath: docs/kb
sessionsDir: .autospec-sessions
ignore:
  - "*.generated.ts"
  - "dist/**"
autoSync:
  enabled: true
  kbUpdate: true
scan:
  excludeDocs: true
  exclude:
    - "generated"
    - "vendor"
```

Config priority: `.autospec.yml` > VS Code settings > defaults.

---

## 📦 Deep KB & Module Awareness (v1.9.0)

v1.9.0 rewrites Knowledge Base generation for large, multi-module projects.

### Zero-skip file scanning

Every file in every module is analyzed — no byte cap, no silent truncation.

| Component | What it does |
|---|---|
| `inventoryAllFiles()` | Walks the full project tree (depth 15) — no size cap |
| `chunkFileInventory()` | Splits large modules into token-budget chunks |
| `analyzeModuleChunk()` | Runs one AI analysis pass per chunk |
| `mergeChunkDocs()` | AI merges chunk analyses into a single module doc |
| `_coverage-report.md` | Generated after scan — shows files analyzed vs total found |

### Java / Kotlin module granularity

Instead of treating `src/main/java` as one module, `resolveJavaPackageRoots()` walks into the package prefix (`com/example/`) and splits at the domain boundary (e.g., `order`, `user`, `payment`), giving each domain package its own KB module doc.

---

## 🛡️ Architecture Protection (v1.10.0)

v1.10.0 adds a **design pattern capture and enforcement** layer.

Before the code generation step, the pipeline reads your project's established patterns from the Knowledge Base (`01-project-overview.md`, `03-project-structure.md`) and injects them as hard constraints into every code generator agent. This ensures:

- Generated code follows the same layering (controller → service → repository)
- Naming conventions match the project (e.g., `*Service`, `*Repository`, `I*` interfaces)
- Framework idioms are preserved (Spring DI, NestJS decorators, Laravel service providers)
- No new patterns are introduced unless explicitly requested

---

## ⚡ Token Safety & Idle Guard (v1.11.x)

Three fixes that prevent hangs and token budget overflows on large projects:

| Version | Fix |
|---|---|
| v1.11.2 | KB generate/update auto-fits each prompt to the model's input limit — no more truncation errors |
| v1.11.3 | Universal token-safe guard on **all** tasks — every AI call is budget-checked before dispatch |
| v1.11.4 | Idle timeout on every AI request — requests that stall for > N seconds are cancelled and retried, eliminating multi-hour hangs |

---

## ⌨️ Keyboard Shortcuts

| Action | Windows / Linux | macOS |
|---|---|---|
| Build Feature (13-step pipeline) | `Ctrl+Shift+K` | `Cmd+Shift+K` |
| Scan Project (generate KB) | `Ctrl+Shift+B` | `Cmd+Shift+B` |
| Plan User Stories | `Ctrl+Shift+U` | `Cmd+Shift+U` |

All other commands: Command Palette (`Ctrl+Shift+P` → `Auto Spec Kit`) or Copilot Chat (`@protector_spec`).

---

## ⚙️ Configuration Reference

Open VS Code Settings (`Ctrl+,`) → search **Auto Spec Kit**:

```jsonc
{
  // Test command for Step 11
  "autoSpecKit.testCommand": "npx jest --coverage --coverageReporters=text 2>&1",

  // Primary language
  "autoSpecKit.language": "typescript",

  // KB folder (relative to workspace)
  "autoSpecKit.knowledgeBasePath": "knowledge-base",

  // Auto-apply generated code without prompt
  "autoSpecKit.autoApplyCode": false,

  // Session output folder
  "autoSpecKit.sessionsDir": "spec-kit-sessions",

  // Preferred Copilot model ID (blank = auto-select best)
  "autoSpecKit.model": "",

  // Show model picker on every run
  "autoSpecKit.askModelOnStart": false,

  // Git auto-sync before every command (v1.8.0)
  "autoSpecKit.autoSync": true,           // fetch + pull (ff-only) before each command
  "autoSpecKit.autoSyncKBUpdate": true,   // auto-update KB when pulled code has source changes

  // Multi-agent settings (v1.7.0)
  "autoSpecKit.agents.maxParallel": 3,
  "autoSpecKit.agents.timeout": 90000,
  "autoSpecKit.agents.mergeStrategy": "ai",
  "autoSpecKit.agents.contextStrategy": "smart"
}
```

---

## 🧠 Knowledge Base

The Knowledge Base is the foundation of Auto Spec Kit. It powers code generation, review, Q&A, and planning.

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

---

## 📁 Session Outputs

Every command run saves to `spec-kit-sessions/<timestamp>/`:

```
spec-kit-sessions/
└── 2026-06-10T14-30-00/
    ├── plan.md
    ├── plan-review.md
    ├── code.md
    ├── code-review.md
    ├── tests.md
    ├── test-review.md
    ├── test-results.md
    ├── evidence.md
    └── kb-delta.md
```

---

## 🛡️ Review Skills System

Two-layer review system:

1. **Universal Template** (`resources/review-skills-universal.md`) — 13 sections: Security, Architecture, Performance, Error Handling, Code Quality, Type Safety, Testability, API Design, Database, Documentation, Observability, DevOps, Business Logic
2. **Section 14 — Project-Specific Rules** — generated by Copilot during KB generation, unique to your project

---

## 🤖 Model Selection & Priority

Built-in priority ranking (2026, updated v1.9.1):

| Priority | Model ID | Notes |
|---|---|---|
| 1 (best) | `gpt-5.5` | Flagship GPT |
| 2 | `claude-opus-4-8` | Flagship Claude |
| 3 | `gpt-5.3-codex` | Code-specialized GPT |
| 4 | `claude-opus-4-7` | — |
| 5 | `gpt-5.4` | — |
| 6 | `claude-opus-4-6` | — |
| 7 | `gemini-3.1-pro` | — |
| 8 | `gemini-2.5-pro` | — |
| 9 | `gpt-5.4-mini` | Lightweight |
| 10 | `o3` | Reasoning |

Override: `"autoSpecKit.model": "gpt-5.5"` in settings.

---

## 🔀 Git Context Integration

Code Review (Step 05) and Review File both load git context:
- Diff vs. default branch (`main`/`master`/`develop`)
- Working tree diff (uncommitted changes)
- Recent commit messages

---

## 🔄 Git Auto-Sync (GitSyncGuard)

Before every command (except `/help`), Auto Spec Kit ensures your workspace is up to date:

```
@protector_spec /build ...
  ├── git fetch --all --prune        ← fetch all remotes
  ├── git pull --ff-only             ← fast-forward merge only
  ├── detect changed source files    ← .ts, .py, .java, .go, etc.
  └── if KB exists + source changed  ← auto-update Knowledge Base
```

**What it does:**
- Fetches all remotes and prunes deleted branches
- Pulls using fast-forward only — never creates merge commits; if the branch has diverged, the pull is skipped
- Checks if any pulled changes touched source files (filters by extension, ignores `node_modules`, `dist`, etc.)
- If the Knowledge Base exists and source files changed, automatically triggers a KB update so your AI context stays fresh

**What it never does:**
- Never runs `git push`, `git commit`, or `git add`
- Never writes to the remote — all operations are strictly read-only
- Never blocks your command — sync failures are logged and skipped (works offline)

**Configuration:**

| Setting | Type | Default | Description |
|---|---|---|---|
| `autoSpecKit.autoSync` | boolean | `true` | Enable/disable auto-fetch/pull before commands |
| `autoSpecKit.autoSyncKBUpdate` | boolean | `true` | Auto-update KB when pulled code has source changes |

In `.autospec.yml`:

```yaml
autoSync:
  enabled: true
  kbUpdate: true
```

---

## 💻 Supported Languages

| Language | KB Scan | Graph Scanner | Code Gen | Test Gen |
|---|---|---|---|---|
| TypeScript / JavaScript | ✅ | ✅ | ✅ | ✅ |
| Java | ✅ | ✅ | ✅ | ✅ |
| Kotlin | ✅ | ✅ | ✅ | ✅ |
| Python | ✅ | ✅ | ✅ | ✅ |
| Go | ✅ | ✅ | ✅ | ✅ |
| C# / .NET | ✅ | ✅ | ✅ | ✅ |
| Ruby | ✅ | ✅ | ✅ | ✅ |
| PHP | ✅ | ✅ | ✅ | ✅ |
| Rust | ✅ | ✅ | ✅ | ✅ |
| Scala / Groovy | ✅ | ✅ | ✅ | ✅ |

**Java Enterprise — full support for:**
Apache Camel, MyBatis (XML mappers), Flyway / Liquibase migrations, Spring XML config, AWS SDK (SQS/S3/Lambda), JPA/Hibernate, Kafka, `.properties` files, Gradle (Groovy & Kotlin DSL).

**Also scanned:** `.xml`, `.properties`, `.json`, `.proto`, `.tf/.hcl` (Terraform), `.ftl` (Freemarker), `.jsp`, `.erb`, `.html` templates.

---

## 💡 Tips & Best Practices

- **Be specific** with `/build` — "Add JWT refresh token rotation with 7-day expiry" beats "add auth"
- **Scan first** (`@protector_spec /scan`) — the pipeline is significantly more accurate with KB context
- **Set `autoSpecKit.testCommand`** so Step 11 runs real tests
- **Use `/review` often** — the 4-agent review catches issues manual review misses
- For **complex tasks**, use `gpt-5.5` or `claude-opus-4-7`; for **fast iterations**, `o4-mini`

---

## 📝 Changelog

### v1.13.0 (current)

**Multi-language graph completeness & zero-skip KB**
- ✅ `CLASS_PATTERN` expanded for all 9 languages — TypeScript `interface`/`enum`, Go `interface`, C# `interface`/`enum`/`record`/`struct`, PHP `interface`/`trait`, Rust `enum`/`trait`
- ✅ `kind` field on parsed nodes — `interface`, `enum`, `trait` render as the correct `interface` node type in the graph
- ✅ `parseFields` added for Go (struct fields), Rust (struct fields + `Arc<T>` unwrap), PHP (typed properties), Ruby (`attr_accessor`)
- ✅ DI edge type resolution — generic inner type extraction (`List<T>` → `T`, `Arc<T>` → `T`), Go `*T` pointer stripped, Rust `&mut T` stripped
- ✅ `CALL_NOISE` constant — 30+ stdlib noise words filtered (Java, Python, Go, Ruby, C#) — cleaner call edges
- ✅ Zero-skip KB: `inventoryAllFiles` + `chunkFileInventory` + `analyzeModuleChunk` + `mergeChunkDocs` — no file is ever skipped
- ✅ `resolveJavaPackageRoots()` — Java/Kotlin domain package discovery for per-domain module analysis
- ✅ `_coverage-report.md` — post-scan coverage report (files analyzed vs total found)
- ✅ Step 10 atomic writes (`.~tmp` → rename) + pre-validation of all destination paths
- ✅ `ProjectProfile` monorepo/Docker/CI detection fix (`hasRoot()` helper); stable sort tiebreaker in `resolvePrimaryBase()`
- ✅ `graph-enricher` AI summary: 80 class nodes, 60 DI injection edges, 12 methods/node

### v1.12.0

**BA answers with diagrams, richer map, token visibility**
- ✅ `/ask` now returns a Mermaid diagram (flowchart / sequence / ER) auto-selected per question type
- ✅ Business-friendly explanation section in every `/ask` answer (non-technical language for PO/BA)
- ✅ Token usage visible in VS Code Output panel per AI call
- ✅ Richer `/map` graph summary injected into AI enrichment context

### v1.11.4

**Idle hang fix**
- ✅ Idle timeout on every AI request — requests stalling past threshold are cancelled and retried; eliminates multi-hour hangs

### v1.11.3

**Universal token guard**
- ✅ Token-safe guard on ALL tasks — every AI call budget-checked before dispatch; no more `context_length_exceeded` errors

### v1.11.2

**KB token auto-fit**
- ✅ KB generate/update auto-fits each prompt to the model's input limit

### v1.11.1

- ✅ Added Protector Spec avatar icon to chat participant

### v1.11.0

**`/document` command**
- ✅ New slash command: `@protector_spec /document <topic>` — investigates a feature/entity/flow and produces a business ↔ code mapping document
- ✅ Exports a self-contained HTML file (opened in webview) + Markdown copy in session folder
- ✅ Two sections per document: business summary (BA-friendly) + technical details (field-level, code references)
- ✅ Chat participant renamed to `@protector_spec`

### v1.10.0

**Architecture protection**
- ✅ Design pattern capture from KB injected into code generator constraints
- ✅ Layer, naming, and framework idioms enforced across all generated code
- ✅ Prevents pattern drift in long-running projects

### v1.9.1

- ✅ Refreshed GitHub Copilot model list (GPT-5.3-Codex, Claude Opus 4.7/4.8, Gemini 3.x)
- ✅ Improved mixed-stack / polyglot project support in KB generation

### v1.9.0

**Deep KB & module awareness**
- ✅ `inventoryAllFiles()` — full file discovery, no byte cap (depth 15)
- ✅ `chunkFileInventory()` + `analyzeModuleChunk()` + `mergeChunkDocs()` — chunked analysis for large modules
- ✅ `resolveJavaPackageRoots()` — Java domain package split for per-domain module docs
- ✅ `maxModules` raised 24 → 100
- ✅ `_coverage-report.md` generated after every scan

### v1.8.4

- ✅ `RequirementClarifier` — scores vague prompts (4 dimensions) and asks targeted clarifying questions before `/build` and `/ask`

### v1.8.3

- ✅ Token context optimization for `/ask` and `/build` — reduces unnecessary prompt padding

### v1.8.1

- ✅ Security hardening: safe file writes, webview CSP, git exec sanitization, untrusted workspace guard

### v1.8.0

**Adaptive Intelligence**
- ✅ `/help` — context-aware status dashboard (KB, model, profile, learnings, workspace, config)
- ✅ `SessionMemory` — persistent context across long chat sessions with rolling compaction
- ✅ `RequirementClarifier` — AI-driven clarity scoring (4 dimensions) + targeted questions
- ✅ `ProjectProfileDetector` — auto-detect language, framework, build tool, test framework, linter, formatter, database, CI/CD, monorepo tool
- ✅ `LearningStore` — reinforcement-based learning from past sessions (review fixes, test patterns, conventions, preferences)
- ✅ `WorkspaceResolver` — multi-root workspace, monorepo (Nx/Turbo/Lerna/pnpm), `.autospec.yml` config
- ✅ `GitSyncGuard` — auto-fetch/pull (ff-only) before every command; auto-updates KB when source files change; never pushes/commits; non-fatal (works offline)
- ✅ Source-only KB scan mode — rebuild KB from code only, excluding outdated docs (README, CONTRIBUTING, CHANGELOG, `docs/`, `.github/`, etc.)
- ✅ `.autospec.yml` expanded with `autoSync` and `scan` config sections
- ✅ All systems integrated into chat-participant.ts and the build pipeline
- ✅ Enriched system prompts: project profile + learnings + session context injected into every AI call

### v1.7.0

**Multi-Agent Architecture**
- ✅ `AgentOrchestrator` — parallel sub-agents with 3 merge strategies (ai/concat/structured)
- ✅ `SmartContextLoader` — File Discovery Agent + per-agent token-budgeted context
- ✅ `TokenBudget` — estimate, allocate, truncate tokens across agents
- ✅ All 8 AI pipeline steps upgraded to multi-agent (3-4 parallel agents each)

**Copilot Chat Integration**
- ✅ `@protector_spec` Chat Participant with 7 slash commands
- ✅ Stream progress and results directly into chat panel
- ✅ Free text defaults to `/ask`

**Pipeline Refactor**
- ✅ `PipelineRunner` with checkpoint/resume via `.pipeline-state.json`
- ✅ 13 step classes replacing 32KB monolith
- ✅ 3 human checkpoints (steps 03, 06, 09)

**Universal Graph Scanner**
- ✅ 12-language support (TS/JS/Python/Java/Kotlin/Scala/Groovy/Go/Ruby/C#/PHP/Rust)
- ✅ Class/method/route/decorator/field detection per language
- ✅ Auto architecture layer inference
- ✅ AI enrichment: Flow Tracer + Entity Mapper + Arch Validator

**KB Generation — Batch Parallelism**
- ✅ 5 batches × 3 parallel steps (was 15 sequential)
- ✅ Critical steps get 3 sub-agents for deeper analysis

**PO/BA User Story Pipeline**
- ✅ 2 inputs only (title + description), AI auto-discovers features
- ✅ 7-step pipeline with per-feature impact analysis
- ✅ Outputs: features.md, confirmation-checklist.md, user-stories.md, sprint-plan.md

**Other**
- ✅ `copilot.ts` — retry with exponential backoff (3 attempts)
- ✅ Jest test suite for utilities
- ✅ `docs/index.html` — 7-tab documentation with SVG diagrams

### v1.6.0
- Added Map Codebase command (D3.js dependency graph)
- 5 view tabs, node click → open file, real-time search

### v1.5.3
- Added Plan User Stories (PO/BA) with HTML sprint board
- Git diff context in code review

### v1.5.0
- Expanded KB to 15 analysis steps with business-depth prompts

### v1.4.1
- Model selection UI with quality ranking

### v1.3.0
- Review Current File, review skills system, Rescan KB

### v1.2.0
- Scan Project (Knowledge Base), Ask About Codebase

### v1.1.0
- Build Feature 13-step pipeline

### v1.0.0
- Initial release

---

## 📄 License

MIT

---

*Built with the `vscode.lm` API — requires GitHub Copilot, no additional API keys needed.*
