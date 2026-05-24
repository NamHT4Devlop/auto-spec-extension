"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KB_STEPS = void 0;
// ═══════════════════════════════════════════════════════════════════════════
// KB STEPS — Deep Business Analysis Edition
// Each prompt is designed to make Copilot reason about BUSINESS INTENT from code,
// not just describe technical structure.
// ═══════════════════════════════════════════════════════════════════════════
exports.KB_STEPS = [
    // ──────────────────────────────────────────────────────────────────────────
    // 01 — PROJECT STRUCTURE
    // Goal: understand topology, who owns what, dependency direction
    // ──────────────────────────────────────────────────────────────────────────
    {
        label: '01 — Project Structure & Ownership Map',
        file: '01-project-structure.md',
        prompt: `Analyze the project structure from PROJECT FILES. Answer the following questions — always cite actual paths:

## 1. Project Type & Scale
- Is this a monolith, monorepo, microservices, or hybrid? Specific evidence?
- How many independent deployable units (service/app/function) exist? List names + paths
- What stage is this project at? (startup MVP, scale-up, enterprise legacy?) — infer from code complexity, feature count, TODO/FIXME comments

## 2. Folder Structure with Business Meaning
Draw the directory tree (2-3 levels deep), for each folder:
- Technical function
- And MORE IMPORTANTLY: what business domain does it represent?

Example format:
\`\`\`
src/
  modules/
    orders/        ← Manages order lifecycle (created→confirmed→shipped→completed)
    inventory/     ← Controls stock levels, prevents overselling
    payments/      ← Payment gateway integration, reconciliation
\`\`\`

## 3. Dependency Direction
Which module depends on which? Draw a simple diagram (text-based OK) to show coupling.
Are there circular dependencies?

## 4. Critical vs Supporting Code
- Which directories contain CORE BUSINESS LOGIC (money is lost if there's a bug)?
- Which directories are just infrastructure/utility?

## 5. Technical Debt Indicators
Find signs of tech debt from structure: God-class files, oversized utils/ directory, inconsistent naming, where are most TODO/FIXME comments?`,
    },
    // ──────────────────────────────────────────────────────────────────────────
    // 02 — TECH STACK
    // Goal: understand WHY each choice was made, not just WHAT
    // ──────────────────────────────────────────────────────────────────────────
    {
        label: '02 — Tech Stack & Architecture Decisions',
        file: '02-tech-stack.md',
        prompt: `Analyze the tech stack from PROJECT FILES (package.json, requirements.txt, go.mod, pom.xml, Dockerfile, docker-compose...).

## 1. Stack Summary Table
| Layer | Technology | Version | Role |
|-------|-----------|---------|------|
| Frontend | ... | ... | ... |
| Backend | ... | ... | ... |
| Database | ... | ... | ... |
| Cache | ... | ... | ... |
| Queue/Event | ... | ... | ... |
| Auth | ... | ... | ... |
| Infra/Deploy | ... | ... | ... |

## 2. Architecture Decision Inferences
For each important technology choice, explain WHY it was selected (infer from how it's used in code):
- Why use X instead of Y (PostgreSQL vs MongoDB, REST vs GraphQL, Redis vs Memcached...)
- Is an ORM used? If yes, are there raw query workarounds? → reveals performance concerns
- Is there a queue/event bus? → reveals need for async processing
- Are there microservices/monorepo? → reveals team structure and scaling strategy

## 3. Version Risks
List dependencies using old versions (compare with latest if known), or deprecated packages.

## 4. Testing Stack
Test framework, coverage tool, mocking library. Read test files to confirm actual setup.

## 5. Build & Deploy Pipeline
Dockerfile, CI/CD config, scripts in package.json → what is the workflow from code to production?`,
    },
    // ──────────────────────────────────────────────────────────────────────────
    // 03 — ENTRY POINTS & RUNTIME BEHAVIOR
    // ──────────────────────────────────────────────────────────────────────────
    {
        label: '03 — Entry Points & Runtime Behavior',
        file: '03-entry-points.md',
        prompt: `Find and analyze all entry points in PROJECT FILES.

## 1. Application Startup Sequence
Trace from the main file (main.ts / index.js / app.py / main.go) to when the app is ready:
1. Module bootstrap order
2. Middleware / plugin registration
3. Database connection & migration
4. Cache warmup if any
5. Port binding / listener start

Cite actual code for each step.

## 2. All Entry Points
List ALL ways external parties can trigger code:
- HTTP API endpoints (prefix, port)
- WebSocket handlers
- Message queue consumers (topic/queue names)
- Cron jobs / scheduled tasks (schedule expression)
- CLI commands
- Event listeners

## 3. Environment Configuration
List ALL env variables from .env.example, config files, docker-compose, code:
| Variable | Required | Default | Business Meaning |
|----------|----------|---------|-----------------|
| DATABASE_URL | Yes | — | Main DB connection |
| JWT_SECRET | Yes | — | Sign JWT tokens |
| ... | | | |

## 4. Health & Observability
- Where is the health check endpoint? What does it check?
- Are metrics/monitoring exposed?
- Logging format and level config

## 5. Local Setup (Step-by-Step)
Detailed guide to run the project from git clone to localhost:PORT ready, based on actual scripts in the project.`,
    },
    // ──────────────────────────────────────────────────────────────────────────
    // 04 — BUSINESS DOMAIN DEEP ANALYSIS
    // Goal: understand what the project does at a business level, not technical
    // ──────────────────────────────────────────────────────────────────────────
    {
        label: '04 — Business Domain & User Stories',
        file: '04-business-domain.md',
        prompt: `Read the ENTIRE codebase and answer as a Business Analyst — not a developer.

## 1. Product Brief
- **What is this product?** (1-2 sentences, written as a pitch to investors)
- **Problem it solves**: what are users suffering from?
- **Who uses it**: list each user type/role and what they gain
- **Core value proposition**: why would users choose this product?

Infer from: entity names, route names, service names, error messages, comments, test cases.

## 2. User Roles & Capabilities Matrix
List all user roles found in code (from enums, guards, decorators, middleware):

| Role | Found at | Can do | Cannot do |
|------|----------|--------|-----------|
| admin | src/auth/roles.enum.ts | ... | ... |
| ... | | | |

## 3. Top 10 Core Features (Ranked by Business Importance)
For each feature:
- Feature name
- User story: "As a [role], I want to [action] so that [business benefit]"
- Main implementation at: [file path]
- Why this is an important feature (infer from code complexity, test coverage, comments)

## 4. User Journey (Main Flow)
Describe the most important user journey from start to finish — in business language, not technical:
"User enters → registers → ... → achieves their goal"

## 5. Business Constraints Evident in Code
Find places where code enforces hard business rules (cannot be bypassed):
- Validation rules in DTO/schema
- Guard conditions in services
- Database constraints (unique, check constraints)
- Hardcoded limits (max items, min amount, time windows)

For each constraint: cite code + explain its business meaning.`,
    },
    // ──────────────────────────────────────────────────────────────────────────
    // 05 — DOMAIN MODEL & ENTITIES
    // ──────────────────────────────────────────────────────────────────────────
    {
        label: '05 — Domain Model & Entity Lifecycle',
        file: '05-domain-model.md',
        prompt: `Analyze all domain entities/models/schemas in PROJECT FILES.

## 1. Entity Catalog
For each entity found (from ORM models, schemas, interfaces, types):

**[EntityName]** — [describe business meaning]
- File: \`path/to/entity.ts\`
- Represents: [what real-world concept?]
- Important fields: [field: type — business meaning]
- States (if any): [enum values — meaning of each state]
- Who creates this entity? Who owns it? Who deletes it?

## 2. State Machines
Which entities have state (status/state field)?
For each state machine:

\`\`\`
[PENDING] → [CONFIRMED] → [PROCESSING] → [COMPLETED]
              ↓                              ↓
           [CANCELLED]                  [REFUNDED]
\`\`\`
- State transition trigger: which function is called, what conditions?
- Business rules on state transition: what is allowed / not allowed?

## 3. Entity Relationships
\`\`\`mermaid
erDiagram
    USER ||--o{ ORDER : "places"
    ORDER ||--|{ ORDER_ITEM : "contains"
    ORDER_ITEM }|--|| PRODUCT : "references"
\`\`\`
Explain the business meaning of each relationship (not just cardinality).

## 4. Aggregate Boundaries
If DDD pattern is used: which entity is the Aggregate Root? What are the boundaries of each aggregate?
If DDD is not clearly present: which entity "owns" which in business logic?

## 5. Data Lifecycle
For each important entity: where is data created, who changes it, and when is it deleted/archived?
Is there soft delete? Where is it in the code?`,
    },
    // ──────────────────────────────────────────────────────────────────────────
    // 06 — MODULES & FEATURE MAP
    // ──────────────────────────────────────────────────────────────────────────
    {
        label: '06 — Module Map & Feature Boundaries',
        file: '06-modules.md',
        prompt: `List and analyze all modules/features in PROJECT FILES.

## 1. Module Overview Table
| Module | Path | Business Domain | Complexity | Depends on |
|--------|------|----------------|------------|------------|
| AuthModule | src/auth/ | Authentication & Authorization | High | UserModule |
| ... | | | | |

Complexity = High/Medium/Low based on: number of files, service methods, test cases.

## 2. Module Deep-Dive (for the most important modules)
For the 3-5 most business-critical modules:

### [ModuleName]
- **Business capability**: what can users do through this module?
- **Key services**: [ServiceName.method()] — what does it do?
- **API surface**: exposed endpoints
- **Business rules enforced**: which rules are checked at this layer?
- **External dependencies**: which services/modules does it call?
- **Known limitations**: any TODOs, FIXMEs, or complex logic to be aware of?

## 3. Cross-Module Communication
How do modules communicate with each other?
- Direct import (tight coupling)?
- Event/message passing (loose coupling)?
- Shared database tables?

Draw a dependency graph (text-based):
\`\`\`
OrderModule ──imports──▶ UserModule
OrderModule ──imports──▶ PaymentModule
OrderModule ──events──▶ NotificationModule
\`\`\`

## 4. Feature Flags / Toggles
Are there any feature flags or conditional features? (find in config, environment checks)

## 5. Module Maturity Assessment
Based on code quality, test coverage, error handling:
- Which modules are "production ready" (stable, well-tested)?
- Which are still WIP / fragile (few tests, many TODOs)?`,
    },
    // ──────────────────────────────────────────────────────────────────────────
    // 07 — SYSTEM ARCHITECTURE
    // ──────────────────────────────────────────────────────────────────────────
    {
        label: '07 — System Architecture & Data Flow',
        file: '07-architecture-diagram.md',
        prompt: `Draw the System Architecture from PROJECT FILES focusing on DATA FLOW — where data goes, through which layers.

## 1. High-Level Architecture Diagram
\`\`\`mermaid
graph TB
    subgraph Client
        Web[Web Browser]
        Mobile[Mobile App]
    end
    subgraph Backend
        API[API Server]
        Worker[Background Worker]
    end
    subgraph Data
        DB[(PostgreSQL)]
        Cache[(Redis)]
        Queue[Message Queue]
    end
    Web --> API
    API --> DB
    API --> Cache
    Worker --> Queue
\`\`\`
Fill in actual values from the codebase, do not use placeholders.

## 2. Request Journey (end-to-end)
Trace an HTTP request from entry to response:
Client → [Load Balancer?] → [API Gateway?] → Controller → Middleware → Service → Repository → DB
State clearly what each layer does, where authentication check happens, where validation happens.

## 3. Async / Background Processing
Are there background jobs, queues, scheduled tasks?
- Job/worker name + file path
- Trigger: cron expression, event name, or manual
- Business purpose: what does it do in background and why not do it synchronously?

## 4. External Service Integration
All third-party services called externally:
| Service | Called from | Protocol | Business Purpose |
|---------|-------------|---------|-----------------|
| Stripe | src/payment/stripe.service.ts | HTTPS | Handle payments |
| SendGrid | src/notification/ | HTTPS | Send email |
| ... | | | |

## 5. Failure Points & Resilience
Which points in the architecture can fail?
- Is there retry logic? Where is it?
- Is there a circuit breaker?
- Is there a fallback when an external service is down?
- Where are database transactions used (critical operations)?`,
    },
    // ──────────────────────────────────────────────────────────────────────────
    // 08 — DATABASE SCHEMA & QUERY PATTERNS
    // ──────────────────────────────────────────────────────────────────────────
    {
        label: '08 — Database Schema & Query Patterns',
        file: '08-database-schema.md',
        prompt: `Analyze the database schema from PROJECT FILES (migration files, entity files, ORM models, schema definitions).

## 1. Schema Overview
List all tables/collections:
| Table | Row estimate | Business Role | Key relationships |
|-------|-------------|--------------|------------------|
| users | many | Identity of every actor | ← orders, sessions |
| ... | | | |

## 2. Full ERD
\`\`\`mermaid
erDiagram
    users {
        uuid id PK
        string email UK
        string role
        timestamp created_at
    }
    orders {
        uuid id PK
        uuid user_id FK
        string status
        decimal total_amount
    }
    users ||--o{ orders : "places"
\`\`\`

## 3. Critical Business Columns
Which columns carry important business logic?
- status/state columns → list allowed values and business meaning
- amount/price columns → currency, precision, business constraints
- Timestamps (created_at, updated_at, deleted_at, expires_at) → lifecycle meaning
- Foreign keys → dependency and cascade behavior

## 4. Index Strategy
List all indexes (from migration/schema files):
- What query does each index serve?
- Are there any obviously missing indexes? (foreign keys without an index?)

## 5. Data Integrity & Constraints
- Database-level constraints: UNIQUE, CHECK, NOT NULL, DEFAULT
- Application-level constraints supplementing the DB
- Soft delete pattern: is there \`deleted_at\` or \`is_deleted\`? Who uses it?

## 6. Migration History (if available)
Read migration files in chronological order — list the most significant schema changes.
What business evolution do these changes reveal? (added feature, bug fix, optimization?)`,
    },
    // ──────────────────────────────────────────────────────────────────────────
    // 09 — AUTH, SECURITY & PERMISSION MODEL
    // ──────────────────────────────────────────────────────────────────────────
    {
        label: '09 — Auth, Security & Permission Model',
        file: '09-auth-security.md',
        prompt: `Analyze the complete authentication, authorization, and security model from PROJECT FILES.

## 1. Authentication Mechanism
- Auth type: JWT, Session, OAuth2, API Key, or combination?
- Token structure: what is in the payload? How long is the expiry? Refresh token flow?
- Cite exact code from the auth service/middleware

## 2. Authorization Model
- RBAC (Role-Based) or ABAC (Attribute-Based) or custom?
- All roles in the system: [Role name — business level description]
- Which Guards/Decorators/Middleware check permissions? (cite paths)

## 3. Permission Matrix
For each important resource/endpoint:
| Resource | Public | User | Admin | SuperAdmin |
|----------|--------|------|-------|-----------|
| GET /products | ✅ | ✅ | ✅ | ✅ |
| POST /orders | ❌ | ✅ | ✅ | ✅ |
| DELETE /users | ❌ | ❌ | ✅ | ✅ |

Fill based on actual guards/decorators in code.

## 4. Auth Flow Sequence Diagrams
\`\`\`mermaid
sequenceDiagram
    actor User
    participant API
    participant AuthService
    participant DB
    User->>API: POST /auth/login {email, password}
    API->>AuthService: validateUser()
    AuthService->>DB: findByEmail()
    DB-->>AuthService: User record
    AuthService->>AuthService: bcrypt.compare()
    AuthService-->>API: {accessToken, refreshToken}
    API-->>User: 200 OK
\`\`\`
Draw similarly for: Register, Token Refresh, Logout.

## 5. Security Hardening
Find security measures in code:
- Input validation (class-validator, Zod, Joi...)
- SQL injection protection (parameterized queries?)
- XSS prevention (output encoding?)
- CORS configuration (allowed origins?)
- Rate limiting (which endpoint, what limit?)
- Secrets management (dotenv, vault, k8s secrets?)
- Password hashing algorithm and config`,
    },
    // ──────────────────────────────────────────────────────────────────────────
    // 10 — CORE BUSINESS FLOWS (MULTI-FLOW)
    // ──────────────────────────────────────────────────────────────────────────
    {
        label: '10 — Core Business Flows (End-to-End)',
        file: '10-core-flows.md',
        prompt: `Identify and diagram ALL important core business flows. This is the most important file in the KB.

For each flow, trace through EVERY LAYER: Controller → Middleware → Service → Repository → DB → External Service.

## Flow 1: [Most important business process — e.g. Create Order]
\`\`\`mermaid
sequenceDiagram
    actor User
    participant Controller
    participant Service
    participant Repository
    participant DB
    participant ExternalService
    User->>Controller: POST /endpoint {payload}
    Controller->>Controller: validate DTO
    Controller->>Service: businessMethod(dto)
    Service->>Service: check business rules
    Service->>Repository: findOne() / save()
    Repository->>DB: SQL query
    DB-->>Repository: result
    Service->>ExternalService: notify/charge/etc
    Service-->>Controller: result
    Controller-->>User: 201 Created
\`\`\`
**Business rules enforced in this flow:**
- [Rule 1]: found at [file:line]
- [Rule 2]: ...

**Error cases:**
- [Error condition] → [HTTP status] + [error message]

## Flow 2: [Second most important business process]
[Same format as above]

## Flow 3: [Third most important business process]
[Same format]

Identify all important flows from the codebase (minimum 3, maximum 7).
Prioritize flows with: complex business logic, multiple service interactions, extensive error handling.`,
    },
    // ──────────────────────────────────────────────────────────────────────────
    // 11 — API DOCUMENTATION
    // ──────────────────────────────────────────────────────────────────────────
    {
        label: '11 — API Reference',
        file: '11-api-docs.md',
        prompt: `List ALL API endpoints from PROJECT FILES (controllers, route files, resolvers).

## API Overview
- Base URL pattern: /api/v?/...
- Authentication: Bearer token / API Key / ...
- Pagination format: ?page=1&limit=20 or cursor-based?
- Standard error response format (cite actual code)

## Endpoints by Module

### [Module Name]
**[METHOD] [PATH]**
- Auth required: Yes/No, Role: ...
- Path params: \`{id}\` — UUID of [entity]
- Query params: \`?status=active\` — filter by...
- Request body:
  \`\`\`json
  {
    "field": "type — description, required/optional"
  }
  \`\`\`
- Success response (200/201):
  \`\`\`json
  { "id": "uuid", ... }
  \`\`\`
- Error cases:
  - 400: validation failed — when does this happen?
  - 401: unauthorized
  - 403: forbidden — insufficient role
  - 404: not found — what condition?
  - 409: conflict — which business rule?
- Business notes: important notes about this endpoint's business logic

[List ALL endpoints — do not omit any]

## Rate Limits & Special Behaviors
Are there any endpoints with special rate limiting? File upload size limit? Special timeouts?`,
    },
    // ──────────────────────────────────────────────────────────────────────────
    // 12 — CODING CONVENTIONS
    // ──────────────────────────────────────────────────────────────────────────
    {
        label: '12 — Coding Conventions & Patterns',
        file: '12-conventions.md',
        prompt: `Analyze coding conventions from PROJECT FILES. Every rule MUST have a real code example.

## 1. Naming Conventions (with real examples)
- Files: [example: user.service.ts, create-order.dto.ts]
- Classes: [example cited from code]
- Interfaces/Types: [example]
- Variables/Functions: [example]
- Constants: [example]
- Database columns/tables: [example]
- API endpoints: [example]
- Test files: [example]

## 2. Folder & File Organization
- New feature: where to create files? What pattern to follow?
- Import order convention? (absolute vs relative paths?)
- Barrel exports (index.ts): are they used? At which layer?

## 3. Architecture Layers & Rules
Trace a feature from request to DB:
\`\`\`
Request → Controller (validation only)
        → Service (business logic, orchestration)
        → Repository (data access only)
        → Entity (pure data, no logic)
\`\`\`
- Which layer is allowed to call which layer?
- Is dependency injection used? Which DI pattern?

## 4. Error Handling Pattern
Cite code examples of how the project handles errors:
- Where are custom exception classes?
- What is the standard HTTP error response format?
- Is there a global exception filter?

## 5. Async/Await Pattern
- Is async/await used throughout? Or is there a mix with Promise.then()?
- Error propagation: throw or return error object?

## 6. Testing Conventions
- Test file naming: \`*.spec.ts\` or \`*.test.ts\`?
- Unit test structure: describe/it blocks pattern
- Mock pattern: jest.mock() or dependency injection mock?
- Factory/fixture pattern for test data?

## 7. Logging Convention
- Logger library: [name, import from where]
- Log levels used: debug/info/warn/error — when to use each?
- Log format: is there a correlation ID?

## 8. "The Rules" — Quick Reference Card
Summarize the 10 most important rules that a new developer needs to remember when contributing to this project.`,
    },
    // ──────────────────────────────────────────────────────────────────────────
    // 13 — BUSINESS RULES & INVARIANTS
    // ──────────────────────────────────────────────────────────────────────────
    {
        label: '13 — Business Rules & Invariants',
        file: '13-business-rules.md',
        prompt: `This is the MOST IMPORTANT step. Find and document ALL business rules implemented in code.

Read carefully: service files, validators, guards, middleware, constants, enums, test cases (test cases reveal business rules most clearly).

## 1. Validation Rules (Input Constraints)
All rules about input data — cite actual code:

| Rule | Applies to | Enforced at | Business Meaning |
|------|------------|-------------|-----------------|
| Email must be unique | User.email | users table UNIQUE | Each email = 1 account |
| Amount > 0 | Order.total | OrderService:45 | No $0 orders allowed |
| Password >= 8 chars | User.password | CreateUserDto | Security requirement |
| ... | | | |

## 2. Business State Rules (State Machine Rules)
For each entity with status/state:
- Which states are allowed to transition to which states?
- What condition is required to change state?
- Who (which role) is allowed to trigger state transitions?

\`\`\`
Order Status Machine:
PENDING   → CONFIRMED  (when: payment success, by: system)
CONFIRMED → SHIPPED    (when: admin confirms shipment, by: admin)
SHIPPED   → DELIVERED  (when: delivery confirmed, by: delivery/system)
PENDING   → CANCELLED  (when: user cancels / timeout, by: user/system)
CONFIRMED → CANCELLED  (when: admin cancels, by: admin ONLY)
DELIVERED → REFUNDED   (when: return request approved, by: admin)
❌ DELIVERED → CANCELLED (NOT allowed)
\`\`\`

## 3. Business Calculation Rules
All calculations with business logic — cite actual formulas from code:
- Price calculation: discount logic, tax, shipping fee...
- Score/rank calculation: if applicable
- Quota/limit calculation: rate limiting per business rules

## 4. Access Control Business Rules
Beyond RBAC — more complex rules:
- User A can only see their own data
- Manager can only see their team
- Paid users can only use feature X
Cite code implementing each rule.

## 5. Time-Based Business Rules
Rules related to time:
- Session expiry
- Order cancellation deadline
- Free trial period
- Rate limits per time window
Cite actual constants and logic.

## 6. Business Invariants (Things That Must Always Be True)
Things that must always be true in the system (regardless of operation):
- "A user's balance is never negative"
- "Order total must equal sum of items"
- "Inventory is never < 0"
Find where code enforces these invariants.

## 7. Under-Enforced Business Rules (Risk)
Find places where business rules are commented but not fully implemented, or TODO/FIXMEs related to business logic.`,
    },
    // ──────────────────────────────────────────────────────────────────────────
    // 14 — INTEGRATION MAP
    // ──────────────────────────────────────────────────────────────────────────
    {
        label: '14 — Integration Map & External Dependencies',
        file: '14-integrations.md',
        prompt: `Find ALL integrations with external systems in PROJECT FILES.
Look in: service files, config files, .env.example, Dockerfile, package.json (SDK names).

## 1. Integration Map
\`\`\`mermaid
graph LR
    App[Our System]
    App -->|HTTPS POST| Stripe[Stripe Payment]
    App -->|SMTP| SendGrid[SendGrid Email]
    App -->|Webhook| Slack[Slack Notifications]
    Firebase[Firebase Auth] -->|OAuth| App
    S3[AWS S3] <-->|Upload/Download| App
\`\`\`
Fill with actual values from code — do not use placeholders.

## 2. Integration Details
For each external service/system:

### [Service Name]
- **SDK/Library**: [package name, version]
- **Implemented at**: [file paths]
- **Credentials**: [env variable names — do not paste values]
- **Business Purpose**: why is this integration needed?
- **Call pattern**: sync (blocking) or async (fire-and-forget)?
- **Error handling**: if this service goes down, how is the business affected? Is there a fallback?
- **Webhooks from this service**: which endpoint receives webhooks? Is the signature verified?
- **Data flow**: what is sent, what is received?

## 3. Internal Service Communication (if microservices)
- Protocol: REST / gRPC / Message Queue / Event Bus
- Service discovery: hardcoded URL / service registry
- Is there distributed tracing?

## 4. Event-Driven Integration
Find all events published/subscribed:
| Event Name | Publisher | Subscribers | Business Trigger |
|------------|-----------|-------------|-----------------|
| order.created | OrderService | EmailService, InventoryService | When an order is created |
| ... | | | |

## 5. Integration Risks & Single Points of Failure
- Which integrations are CRITICAL (the app cannot function without them)?
- Which integrations are OPTIONAL (degraded mode is acceptable)?
- Are there any concerning vendor lock-ins?`,
    },
    // ──────────────────────────────────────────────────────────────────────────
    // 15 — ERROR SCENARIOS & OPERATIONAL GUIDE
    // ──────────────────────────────────────────────────────────────────────────
    {
        label: '15 — Error Scenarios & Operational Runbook',
        file: '15-error-scenarios.md',
        prompt: `Analyze error handling and create an operational runbook from PROJECT FILES.
Read: exception handlers, error constants, try/catch blocks, test cases with error scenarios.

## 1. Error Response Taxonomy
All error codes/types in the system:

| Error Code | HTTP Status | Business Meaning | When it occurs |
|------------|-------------|-----------------|----------------|
| USER_NOT_FOUND | 404 | User does not exist | GET /users/:id with unknown id |
| INSUFFICIENT_FUNDS | 400 | Insufficient balance | Checkout when balance < total |
| EMAIL_ALREADY_EXISTS | 409 | Email already registered | Register with an existing email |
| ... | | | |

Cite from: error constants, exception classes, test assertions.

## 2. Critical Error Scenarios (Business Impact)
Errors that could cause loss of money / data / users:

### [Scenario: Payment Processing Failure]
- **Trigger**: Stripe charge fails after order has been created
- **Current handling**: [cite handling code]
- **Risk**: Order created but payment not collected
- **Recovery**: [is there an idempotency key? retry logic?]
- **Monitoring**: is there an alert?

[List 5-10 similar critical scenarios]

## 3. Data Consistency Risks
Find places where race conditions or inconsistent state can occur:
- Is there distributed transaction handling? 2-phase commit?
- Optimistic vs pessimistic locking — where?
- Is there a saga pattern?

## 4. Graceful Degradation
How does the system behave when external services are down?
- Is there a circuit breaker?
- Queue/retry for failed operations?
- Cache fallback?

## 5. Operational Runbook (Common Issues)
| Symptom | Possible Cause | How to debug | How to fix |
|---------|---------------|-------------|-----------|
| Slow API response | DB query missing index, N+1 query | Check query logs | Add index, optimize query |
| Payment webhook missing | Wrong Stripe webhook secret | Check STRIPE_WEBHOOK_SECRET | Update env var |
| ... | | | |

## 6. Logging & Observability
- Which business events are logged? (find logger.log/info in service files)
- Is there a correlation/request ID in logs?
- How to trace a request from start to finish in logs?`,
    },
];
// Final step (review-skills.md) is handled separately in generate-kb.ts
// because it merges the Universal Template + Project-Specific Section 14.
// Total KB files = KB_STEPS.length + 1 (review-skills.md) + 1 (_project-scan.md)
