export interface KbStep {
  label: string;
  file: string;
  prompt: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// KB STEPS — Deep Business Analysis Edition
// Each prompt is designed to make Copilot reason about BUSINESS INTENT from code,
// not just describe technical structure.
// ═══════════════════════════════════════════════════════════════════════════

export const KB_STEPS: KbStep[] = [

  // 01 — PROJECT STRUCTURE
  {
    label: '01 — Project Structure & Ownership Map',
    file: '01-project-structure.md',
    prompt: `Analyze the project structure from PROJECT FILES. Answer the following questions — always cite actual paths:

## 1. Project Type & Scale
- Is this a monolith, monorepo, microservices, or hybrid? Specific evidence?
- How many independent deployable units (service/app/function) exist? List names + paths
- What stage is this project at? (startup MVP, scale-up, enterprise legacy?)

## 2. Folder Structure with Business Meaning
Draw the directory tree (2-3 levels deep), for each folder:
- Technical function
- And MORE IMPORTANTLY: what business domain does it represent?

## 3. Dependency Direction
Which module depends on which? Draw a simple diagram (text-based OK) to show coupling.

## 4. Critical vs Supporting Code
- Which directories contain CORE BUSINESS LOGIC?
- Which directories are just infrastructure/utility?

## 5. Technical Debt Indicators
Find signs of tech debt from structure.`,
  },

  // 02 — TECH STACK
  {
    label: '02 — Tech Stack & Architecture Decisions',
    file: '02-tech-stack.md',
    prompt: `Analyze the tech stack from PROJECT FILES.

## 1. Stack Summary Table
| Layer | Technology | Version | Role |

## 2. Architecture Decision Inferences
For each important technology choice, explain WHY it was selected.

## 3. Version Risks
List dependencies using old versions or deprecated packages.

## 4. Testing Stack
Test framework, coverage tool, mocking library — check package.json, pom.xml, build.gradle, Gemfile, go.mod, or equivalent.

## 5. Build & Deploy Pipeline
Build tool (Maven/Gradle/npm/yarn/make/cargo), Dockerfile, CI/CD config, build scripts. Include plugin configurations (Maven plugins, Gradle tasks, npm scripts).`,
  },

  // 03 — ENTRY POINTS & RUNTIME BEHAVIOR
  {
    label: '03 — Entry Points & Runtime Behavior',
    file: '03-entry-points.md',
    prompt: `Find and analyze all entry points in PROJECT FILES.

## 1. Application Startup Sequence
Trace from the main file to when the app is ready.

## 2. All Entry Points
List ALL ways external parties can trigger code.

## 3. Environment Configuration
List ALL env variables, application.properties/yml settings, Spring profiles, .env files, and config classes.

## 4. Health & Observability
Health check endpoints, actuator, metrics, tracing, logging configuration.

## 5. Local Setup (Step-by-Step)
Prerequisites, DB setup, migrations (Flyway/Liquibase/Prisma), seed data, run commands.`,
  },

  // 04 — BUSINESS DOMAIN DEEP ANALYSIS
  {
    label: '04 — Business Domain & User Stories',
    file: '04-business-domain.md',
    prompt: `Read the ENTIRE codebase and answer as a Business Analyst.

## 1. Product Brief
## 2. User Roles & Capabilities Matrix
## 3. Top 10 Core Features (Ranked by Business Importance)
## 4. User Journey (Main Flow)
## 5. Business Constraints Evident in Code`,
  },

  // 05 — DOMAIN MODEL & ENTITIES
  {
    label: '05 — Domain Model & Entity Lifecycle',
    file: '05-domain-model.md',
    prompt: `Analyze all domain entities/models/schemas in PROJECT FILES. Check ALL sources: JPA @Entity classes, Prisma schema, TypeORM entities, Django models, ActiveRecord, MyBatis mapper XML (resultMap/resultType), SQL CREATE TABLE, Proto messages.

## 1. Entity Catalog
## 2. State Machines
## 3. Entity Relationships
Include ORM-mapped relationships AND MyBatis XML joins/associations.
## 4. Aggregate Boundaries
## 5. Data Lifecycle`,
  },

  // 06 — MODULES & FEATURE MAP
  {
    label: '06 — Module Map & Feature Boundaries',
    file: '06-modules.md',
    prompt: `List and analyze all modules/features in PROJECT FILES.

## 1. Module Overview Table
## 2. Module Deep-Dive
## 3. Cross-Module Communication
## 4. Feature Flags / Toggles
## 5. Module Maturity Assessment`,
  },

  // 07 — SYSTEM ARCHITECTURE
  {
    label: '07 — System Architecture & Data Flow',
    file: '07-architecture-diagram.md',
    prompt: `Draw the System Architecture from PROJECT FILES focusing on DATA FLOW.

## 1. High-Level Architecture Diagram
## 2. Request Journey (end-to-end)
## 3. Async / Background Processing
## 4. External Service Integration
## 5. Failure Points & Resilience`,
  },

  // 08 — DATABASE SCHEMA & QUERY PATTERNS
  {
    label: '08 — Database Schema & Query Patterns',
    file: '08-database-schema.md',
    prompt: `Analyze the database schema from PROJECT FILES.

## 1. Schema Overview
Analyze entities/tables from: JPA @Entity, Prisma schema, TypeORM entities, Django models, ActiveRecord, SQL migrations, MyBatis mapper XML resultMaps.

## 2. Full ERD
## 3. Critical Business Columns
## 4. Index Strategy
## 5. Data Integrity & Constraints
Include DB-level constraints AND ORM-level validation (Bean Validation @NotNull/@Size, Prisma @unique, Rails validates).

## 6. Migration History
Analyze Flyway V*.sql, Liquibase changelog, Prisma migrations, Rails db/migrate, Alembic — what business decisions drove each schema change?`,
  },

  // 09 — AUTH, SECURITY & PERMISSION MODEL
  {
    label: '09 — Auth, Security & Permission Model',
    file: '09-auth-security.md',
    prompt: `Analyze the complete authentication, authorization, and security model.

## 1. Authentication Mechanism
## 2. Authorization Model
## 3. Permission Matrix
## 4. Auth Flow Sequence Diagrams
## 5. Security Hardening`,
  },

  // 10 — CORE BUSINESS FLOWS
  {
    label: '10 — Core Business Flows (End-to-End)',
    file: '10-core-flows.md',
    prompt: `Identify and diagram ALL important core business flows. This is the most important file in the KB.

For each flow, trace through EVERY LAYER.
Identify all important flows (minimum 3, maximum 7).`,
  },

  // 11 — API DOCUMENTATION
  {
    label: '11 — API Reference',
    file: '11-api-docs.md',
    prompt: `List ALL API endpoints from PROJECT FILES.

## API Overview
## Endpoints by Module
## Rate Limits & Special Behaviors`,
  },

  // 12 — CODING CONVENTIONS
  {
    label: '12 — Coding Conventions & Patterns',
    file: '12-conventions.md',
    prompt: `Analyze coding conventions from PROJECT FILES. Every rule MUST have a real code example.

## 1. Naming Conventions
## 2. Folder & File Organization
## 3. Architecture Layers & Rules
## 4. Error Handling Pattern
## 5. Async/Await Pattern
## 6. Testing Conventions
## 7. Logging Convention
## 8. "The Rules" — Quick Reference Card`,
  },

  // 13 — BUSINESS RULES & INVARIANTS
  {
    label: '13 — Business Rules & Invariants',
    file: '13-business-rules.md',
    prompt: `This is the MOST IMPORTANT step. Find and document ALL business rules implemented in code.

## 1. Validation Rules (Input Constraints)
## 2. Business State Rules (State Machine Rules)
## 3. Business Calculation Rules
## 4. Access Control Business Rules
## 5. Time-Based Business Rules
## 6. Business Invariants
## 7. Under-Enforced Business Rules (Risk)`,
  },

  // 14 — INTEGRATION MAP
  {
    label: '14 — Integration Map & External Dependencies',
    file: '14-integrations.md',
    prompt: `Find ALL integrations with external systems in PROJECT FILES.

## 1. Integration Map
List ALL external systems: REST APIs, SOAP services, message queues (SQS, Kafka, RabbitMQ), cloud services (AWS S3/Lambda/DynamoDB, GCP, Azure), payment gateways, email/SMS providers, search engines (Elasticsearch), caches (Redis).

## 2. Integration Details
For each integration: protocol, auth method, retry policy, circuit breaker, timeout config, error handling.

## 3. Internal Service Communication
REST, gRPC, message queues, Apache Camel routes, event bus, shared database.

## 4. Event-Driven Integration
Kafka topics, SQS queues, SNS topics, RabbitMQ exchanges, Spring Events, domain events — document producers, consumers, message schemas.

## 5. Integration Risks & Single Points of Failure`,
  },

  // 15 — ERROR SCENARIOS & OPERATIONAL GUIDE
  {
    label: '15 — Error Scenarios & Operational Runbook',
    file: '15-error-scenarios.md',
    prompt: `Analyze error handling and create an operational runbook.

## 1. Error Response Taxonomy
## 2. Critical Error Scenarios (Business Impact)
## 3. Data Consistency Risks
## 4. Graceful Degradation
## 5. Operational Runbook (Common Issues)
## 6. Logging & Observability`,
  },

  // 16 — ARCHITECTURE & DESIGN PATTERNS (guardrails for safe changes)
  {
    label: '16 — Architecture & Design Patterns',
    file: '16-architecture-patterns.md',
    prompt: `You are a software architect. Document the ACTUAL architecture and design patterns used in this codebase so future changes follow them and DO NOT break the design. Cite real files/classes for every pattern. A large repo often mixes MULTIPLE patterns — capture each one and WHERE it applies.

## 1. Architectural Style(s)
Identify the architectural style(s) in use and where each applies (per module/layer). Examples: Layered (Controller→Service→Repository), Hexagonal / Ports & Adapters, Clean/Onion, DDD (aggregates, domain events), CQRS, Event-Driven, Pipeline/Routes (e.g., Apache Camel), Transaction Script, MVC, Modular Monolith, Microservices. For each: which module/package uses it + evidence.

## 2. Design Patterns Catalog
List every recurring design pattern with a real example (file + class): Repository/DAO, Factory, Builder, Strategy, Adapter, Facade, Decorator, Observer/Listener, Template Method, Singleton/Bean, Dependency Injection, Specification, Mapper/Converter, Unit of Work, Saga, Outbox, etc. Note WHEN to use each in this project.

## 3. Layer & Dependency Rules (allowed vs forbidden)
Define the dependency direction rules. Make them explicit and enforceable:
- ALLOWED: e.g. Controller → Service → Repository → DB
- FORBIDDEN: e.g. Controller must NOT call Repository/DB directly; Domain must NOT import infrastructure; no circular deps between modules X and Y.
Cite where the rule is currently honored.

## 4. Module Boundaries & Communication
How modules/bounded-contexts talk to each other (direct call, interface/port, events, queue, shared DB). What crossing-the-boundary is allowed vs not.

## 5. Extension Recipes ("how to add X the right way")
Step-by-step recipes that match THIS codebase's patterns, e.g.:
- "Add a new REST endpoint" → which files, in which order, following which pattern.
- "Add a new entity + persistence" → entity, repository/mapper, migration, service.
- "Add a new async consumer / Camel route / SQS handler".
Each recipe cites an existing example to copy from.

## 6. Architecture Invariants — DO NOT BREAK
A numbered checklist of hard rules new code MUST satisfy (layering, naming, transaction boundaries, error handling location, where validation lives, idempotency for consumers, etc.). Mark severity [CRITICAL]/[MAJOR]. This list is used to review every generated change.`,
  },

];
