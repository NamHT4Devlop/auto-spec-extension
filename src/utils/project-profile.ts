/**
 * project-profile.ts — Auto-Detect Project Stack & Conventions
 *
 * Scans the workspace to build a profile that describes:
 *   - Language, framework, build tool
 *   - Test framework, linter, formatter
 *   - Folder structure pattern (e.g., src/controllers, app/models)
 *   - Naming conventions (kebab-case files, PascalCase classes)
 *   - Package manager, monorepo tool
 *
 * Stored in .autospec/profile.json and injected into every prompt
 * so the AI understands the project without user configuration.
 */

import * as fs from 'fs';
import * as path from 'path';
import { log } from '../logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProjectProfile {
  /** When this profile was generated */
  generatedAt: string;
  /** Primary language */
  language: string;
  /** Framework (e.g., Spring Boot, Rails, Next.js, Express) */
  framework: string;
  /** Build tool (Maven, Gradle, npm, yarn, pnpm, bundler) */
  buildTool: string;
  /** Test framework (Jest, JUnit, RSpec, pytest, go test) */
  testFramework: string;
  /** Package manager */
  packageManager: string;
  /** Monorepo tool if detected */
  monorepoTool?: string;
  /** Detected linter (ESLint, RuboCop, golangci-lint) */
  linter?: string;
  /** Detected formatter (Prettier, gofmt, Black) */
  formatter?: string;
  /** Key folder patterns found */
  folderPatterns: string[];
  /** File naming convention (kebab-case, camelCase, snake_case, PascalCase) */
  fileNaming: string;
  /** Entry points discovered */
  entryPoints: string[];
  /** DB type if detectable */
  database?: string;
  /** All tech stacks detected in the repo (polyglot/monorepo aware), e.g. ["Java/Maven","Ruby/Rails"] */
  additionalStacks?: string[];
  /** Docker/container detected */
  hasDocker: boolean;
  /** CI/CD detected */
  cicd?: string;
}

// ─── Detector ─────────────────────────────────────────────────────────────────

export class ProjectProfileDetector {
  private root: string;

  constructor(workspaceRoot: string) {
    this.root = workspaceRoot;
  }

  /**
   * Generate profile. If a cached profile exists and is <24h old, return it.
   * Otherwise re-detect.
   */
  detect(forceRefresh: boolean = false): ProjectProfile {
    const profilePath = path.join(this.root, '.autospec', 'profile.json');

    if (!forceRefresh && fs.existsSync(profilePath)) {
      try {
        const cached = JSON.parse(fs.readFileSync(profilePath, 'utf-8')) as ProjectProfile;
        const age = Date.now() - new Date(cached.generatedAt).getTime();
        if (age < 24 * 60 * 60 * 1000) {
          log('📋 ProjectProfile: using cached profile (<24h old)');
          return cached;
        }
      } catch { /* re-detect */ }
    }

    log('📋 ProjectProfile: detecting project stack...');
    const profile = this.scan();
    this.save(profile);
    return profile;
  }

  /**
   * Get a concise summary string for prompt injection (~200 tokens).
   */
  static toPromptContext(profile: ProjectProfile): string {
    const parts = [
      `Language: ${profile.language}`,
      `Framework: ${profile.framework}`,
      `Build: ${profile.buildTool}`,
      `Tests: ${profile.testFramework}`,
      `Package Manager: ${profile.packageManager}`,
    ];
    if (profile.monorepoTool) { parts.push(`Monorepo: ${profile.monorepoTool}`); }
    if (profile.linter) { parts.push(`Linter: ${profile.linter}`); }
    if (profile.formatter) { parts.push(`Formatter: ${profile.formatter}`); }
    if (profile.database) { parts.push(`Database: ${profile.database}`); }
    if (profile.additionalStacks && profile.additionalStacks.length > 1) {
      parts.push(`Polyglot stacks: ${profile.additionalStacks.join(', ')}`);
    }
    if (profile.hasDocker) { parts.push('Docker: yes'); }
    if (profile.cicd) { parts.push(`CI/CD: ${profile.cicd}`); }
    parts.push(`File naming: ${profile.fileNaming}`);
    if (profile.folderPatterns.length > 0) {
      parts.push(`Folders: ${profile.folderPatterns.join(', ')}`);
    }
    return parts.join(' | ');
  }

  // ── Detection logic ────────────────────────────────────────────────

  private scan(): ProjectProfile {
    const has = (f: string) => fs.existsSync(path.join(this.root, f));
    const readJson = (f: string) => {
      try { return JSON.parse(fs.readFileSync(path.join(this.root, f), 'utf-8')); }
      catch { return null; }
    };

    // ── Language & Framework ──
    let language = 'unknown';
    let framework = 'unknown';
    let buildTool = 'unknown';
    let testFramework = 'unknown';
    let packageManager = 'unknown';

    // Java / JVM (Maven)
    if (has('pom.xml')) {
      const pom = fs.readFileSync(path.join(this.root, 'pom.xml'), 'utf-8');
      // Detect JVM language variant
      if (pom.includes('kotlin') || has('src/main/kotlin')) { language = 'kotlin'; }
      else if (pom.includes('scala') || has('src/main/scala')) { language = 'scala'; }
      else { language = 'java'; }
      buildTool = 'maven'; packageManager = 'maven';

      // Framework detection (order: most specific first)
      const frameworkParts: string[] = [];
      if (pom.includes('spring-boot')) { frameworkParts.push('Spring Boot'); }
      else if (pom.includes('spring')) { frameworkParts.push('Spring'); }
      else if (pom.includes('quarkus')) { frameworkParts.push('Quarkus'); }
      else if (pom.includes('micronaut')) { frameworkParts.push('Micronaut'); }

      // Detect enterprise integrations
      if (pom.includes('camel')) { frameworkParts.push('Apache Camel'); }
      if (pom.includes('mybatis')) { frameworkParts.push('MyBatis'); }
      if (pom.includes('flyway')) { frameworkParts.push('Flyway'); }
      if (pom.includes('liquibase')) { frameworkParts.push('Liquibase'); }
      if (pom.includes('aws-java-sdk') || pom.includes('software.amazon')) { frameworkParts.push('AWS SDK'); }
      if (pom.includes('hibernate') || pom.includes('jakarta.persistence')) { frameworkParts.push('JPA/Hibernate'); }
      if (pom.includes('kafka')) { frameworkParts.push('Kafka'); }

      framework = frameworkParts.length > 0 ? frameworkParts.join(' + ') : `${language} (Maven)`;

      if (pom.includes('junit-jupiter') || pom.includes('junit')) { testFramework = 'JUnit 5'; }
      else if (pom.includes('testng')) { testFramework = 'TestNG'; }
      else if (pom.includes('spock')) { testFramework = 'Spock'; }
    }
    // Java / JVM (Gradle)
    else if (has('build.gradle') || has('build.gradle.kts')) {
      const gradleFile = has('build.gradle.kts') ? 'build.gradle.kts' : 'build.gradle';
      const gradle = fs.readFileSync(path.join(this.root, gradleFile), 'utf-8');

      if (has('build.gradle.kts') || gradle.includes('kotlin') || has('src/main/kotlin')) { language = 'kotlin'; }
      else if (gradle.includes('scala') || has('src/main/scala')) { language = 'scala'; }
      else if (gradle.includes('groovy') || has('src/main/groovy')) { language = 'groovy'; }
      else { language = 'java'; }
      buildTool = 'gradle'; packageManager = 'gradle';

      const frameworkParts: string[] = [];
      if (gradle.includes('spring-boot') || gradle.includes('org.springframework.boot')) { frameworkParts.push('Spring Boot'); }
      if (gradle.includes('camel')) { frameworkParts.push('Apache Camel'); }
      if (gradle.includes('mybatis')) { frameworkParts.push('MyBatis'); }
      if (gradle.includes('flyway')) { frameworkParts.push('Flyway'); }
      if (gradle.includes('aws')) { frameworkParts.push('AWS SDK'); }

      framework = frameworkParts.length > 0 ? frameworkParts.join(' + ') : `${language} (Gradle)`;
      testFramework = gradle.includes('spock') ? 'Spock' : 'JUnit 5';
    }

    // Node.js / TypeScript
    else if (has('package.json')) {
      const pkg = readJson('package.json') ?? {};
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      language = deps['typescript'] || has('tsconfig.json') ? 'typescript' : 'javascript';
      packageManager = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : 'npm';

      // Framework detection
      if (deps['next']) { framework = 'Next.js'; }
      else if (deps['nuxt'] || deps['nuxt3']) { framework = 'Nuxt'; }
      else if (deps['@angular/core']) { framework = 'Angular'; }
      else if (deps['react'] && deps['react-native']) { framework = 'React Native'; }
      else if (deps['react']) { framework = 'React'; }
      else if (deps['vue']) { framework = 'Vue.js'; }
      else if (deps['express']) { framework = 'Express'; }
      else if (deps['fastify']) { framework = 'Fastify'; }
      else if (deps['@nestjs/core']) { framework = 'NestJS'; }
      else if (deps['hono']) { framework = 'Hono'; }
      else { framework = language === 'typescript' ? 'TypeScript' : 'Node.js'; }

      buildTool = deps['vite'] ? 'vite' : deps['webpack'] ? 'webpack' : deps['esbuild'] ? 'esbuild' : packageManager;

      // Test framework
      if (deps['jest'] || deps['@jest/core']) { testFramework = 'Jest'; }
      else if (deps['vitest']) { testFramework = 'Vitest'; }
      else if (deps['mocha']) { testFramework = 'Mocha'; }
      else if (deps['ava']) { testFramework = 'Ava'; }
      else if (deps['playwright'] || deps['@playwright/test']) { testFramework = 'Playwright'; }
      else if (deps['cypress']) { testFramework = 'Cypress'; }
    }

    // Python
    else if (has('pyproject.toml') || has('setup.py') || has('requirements.txt')) {
      language = 'python';
      packageManager = has('poetry.lock') ? 'poetry' : has('Pipfile') ? 'pipenv' : 'pip';
      buildTool = packageManager;

      if (has('manage.py')) { framework = 'Django'; }
      else if (this.grepFile('pyproject.toml', 'fastapi') || this.grepFile('requirements.txt', 'fastapi')) { framework = 'FastAPI'; }
      else if (this.grepFile('requirements.txt', 'flask')) { framework = 'Flask'; }
      else { framework = 'Python'; }

      testFramework = has('.pytest.ini') || has('pytest.ini') || this.grepFile('pyproject.toml', 'pytest') ? 'pytest' : 'unittest';
    }

    // Ruby
    else if (has('Gemfile')) {
      language = 'ruby'; packageManager = 'bundler'; buildTool = 'bundler';
      if (has('config/routes.rb')) { framework = 'Ruby on Rails'; }
      else if (this.grepFile('Gemfile', 'sinatra')) { framework = 'Sinatra'; }
      else { framework = 'Ruby'; }
      testFramework = this.grepFile('Gemfile', 'rspec') ? 'RSpec' : 'Minitest';
    }

    // Go
    else if (has('go.mod')) {
      language = 'go'; packageManager = 'go modules'; buildTool = 'go';
      if (this.grepFile('go.mod', 'gin-gonic')) { framework = 'Gin'; }
      else if (this.grepFile('go.mod', 'echo')) { framework = 'Echo'; }
      else if (this.grepFile('go.mod', 'fiber')) { framework = 'Fiber'; }
      else { framework = 'Go'; }
      testFramework = 'go test';
    }

    // C# / .NET
    else if (this.findFile('*.csproj') || this.findFile('*.sln')) {
      language = 'csharp'; buildTool = 'dotnet'; packageManager = 'nuget';
      framework = '.NET';
      testFramework = 'xUnit';
    }

    // ── Monorepo ──
    let monorepoTool: string | undefined;
    if (has('nx.json')) { monorepoTool = 'Nx'; }
    else if (has('turbo.json')) { monorepoTool = 'Turborepo'; }
    else if (has('lerna.json')) { monorepoTool = 'Lerna'; }
    else if (has('pnpm-workspace.yaml')) { monorepoTool = 'pnpm workspaces'; }

    // ── Linter / Formatter ──
    let linter: string | undefined;
    if (has('.eslintrc.js') || has('.eslintrc.json') || has('eslint.config.js') || has('eslint.config.mjs')) { linter = 'ESLint'; }
    else if (has('.rubocop.yml')) { linter = 'RuboCop'; }
    else if (has('.golangci.yml')) { linter = 'golangci-lint'; }
    else if (has('.flake8') || has('setup.cfg')) { linter = 'Flake8'; }

    let formatter: string | undefined;
    if (has('.prettierrc') || has('.prettierrc.json') || has('prettier.config.js')) { formatter = 'Prettier'; }
    else if (has('pyproject.toml') && this.grepFile('pyproject.toml', 'black')) { formatter = 'Black'; }
    else if (language === 'go') { formatter = 'gofmt'; }

    // ── Database ──
    let database: string | undefined;
    if (has('prisma/schema.prisma')) { database = 'PostgreSQL (Prisma)'; }
    else if (this.grepFile('package.json', 'pg') || this.grepFile('package.json', 'typeorm')) { database = 'PostgreSQL'; }
    else if (this.grepFile('package.json', 'mongoose') || this.grepFile('package.json', 'mongodb')) { database = 'MongoDB'; }
    else if (this.grepFile('package.json', 'mysql2')) { database = 'MySQL'; }
    else if (has('config/database.yml')) { database = 'PostgreSQL (Rails)'; }
    // Java enterprise DB detection (config usually lives under src/main/resources/)
    else {
      const appConfig = this.readFirst([
        'application.properties', 'application.yml', 'application.yaml',
        'src/main/resources/application.properties',
        'src/main/resources/application.yml',
        'src/main/resources/application.yaml',
      ]).toLowerCase();
      if (appConfig) {
        if (appConfig.includes('postgresql') || appConfig.includes('postgres')) { database = 'PostgreSQL'; }
        else if (appConfig.includes('mysql') || appConfig.includes('mariadb')) { database = 'MySQL'; }
        else if (appConfig.includes('oracle')) { database = 'Oracle'; }
        else if (appConfig.includes('sqlserver') || appConfig.includes('mssql')) { database = 'SQL Server'; }
        else if (appConfig.includes('h2')) { database = 'H2 (embedded)'; }
        else if (appConfig.includes('mongodb')) { database = 'MongoDB'; }
        else if (appConfig.includes('redis')) { database = 'Redis'; }
      }
    }

    // ── Polyglot / monorepo stacks (manifests anywhere within depth 2) ──
    const additionalStacks = this.detectStacks();

    // ── Docker & CI/CD ──
    const hasDocker = has('Dockerfile') || has('docker-compose.yml') || has('docker-compose.yaml');
    let cicd: string | undefined;
    if (has('.github/workflows')) { cicd = 'GitHub Actions'; }
    else if (has('.gitlab-ci.yml')) { cicd = 'GitLab CI'; }
    else if (has('Jenkinsfile')) { cicd = 'Jenkins'; }
    else if (has('.circleci/config.yml')) { cicd = 'CircleCI'; }
    else if (has('bitbucket-pipelines.yml')) { cicd = 'Bitbucket Pipelines'; }

    // ── Folder patterns ──
    const folderPatterns = this.detectFolderPatterns();

    // ── File naming ──
    const fileNaming = this.detectFileNaming();

    // ── Entry points ──
    const entryPoints = this.detectEntryPoints(language, framework);

    const profile: ProjectProfile = {
      generatedAt: new Date().toISOString(),
      language, framework, buildTool, testFramework, packageManager,
      monorepoTool, linter, formatter, folderPatterns, fileNaming,
      entryPoints, database, additionalStacks, hasDocker, cicd,
    };

    log(`📋 ProjectProfile: ${language} / ${framework} / ${testFramework}`);
    if (additionalStacks.length > 1) {
      log(`📋 ProjectProfile: polyglot repo — stacks: ${additionalStacks.join(', ')}`);
    }
    return profile;
  }

  /** Read the first existing file from a list of candidate relative paths. */
  private readFirst(relPaths: string[]): string {
    for (const rel of relPaths) {
      try {
        const full = path.join(this.root, rel);
        if (fs.existsSync(full)) { return fs.readFileSync(full, 'utf-8'); }
      } catch { /* next */ }
    }
    return '';
  }

  /** Detect all tech stacks present (root + immediate sub-dirs) for polyglot/monorepo repos. */
  private detectStacks(): string[] {
    const probe: Record<string, string> = {
      'pom.xml': 'Java/Maven', 'build.gradle': 'Java/Gradle', 'build.gradle.kts': 'Kotlin/Gradle',
      'package.json': 'Node/TypeScript', 'Gemfile': 'Ruby/Rails', 'go.mod': 'Go',
      'requirements.txt': 'Python', 'pyproject.toml': 'Python', 'composer.json': 'PHP', 'Cargo.toml': 'Rust',
    };
    const skip = new Set([
      'node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor',
      'coverage', '.gradle', '.idea', '.vscode', 'spec-kit-sessions', 'knowledge-base',
    ]);
    const found = new Set<string>();
    const walk = (dir: string, depth: number) => {
      if (depth > 2) { return; }
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.isFile()) {
          if (probe[e.name]) { found.add(probe[e.name]); }
        } else if (e.isDirectory() && !e.name.startsWith('.') && !skip.has(e.name)) {
          walk(path.join(dir, e.name), depth + 1);
        }
      }
    };
    walk(this.root, 0);
    return [...found];
  }

  private save(profile: ProjectProfile): void {
    const dir = path.join(this.root, '.autospec');
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    fs.writeFileSync(path.join(dir, 'profile.json'), JSON.stringify(profile, null, 2));
    log('📋 ProjectProfile: saved to .autospec/profile.json');
  }

  private grepFile(relPath: string, needle: string): boolean {
    try {
      const content = fs.readFileSync(path.join(this.root, relPath), 'utf-8');
      return content.toLowerCase().includes(needle.toLowerCase());
    } catch { return false; }
  }

  private findFile(pattern: string): boolean {
    try {
      const ext = pattern.replace('*', '');
      const entries = fs.readdirSync(this.root);
      return entries.some(e => e.endsWith(ext));
    } catch { return false; }
  }

  private detectFolderPatterns(): string[] {
    const patterns: string[] = [];
    const check = (dir: string, label: string) => {
      if (fs.existsSync(path.join(this.root, dir))) { patterns.push(label); }
    };

    check('src/controllers', 'MVC (controllers)');
    check('src/services', 'Service layer');
    check('src/models', 'Models');
    check('src/routes', 'Route-based');
    check('src/components', 'Component-based (React/Vue)');
    check('src/pages', 'Page-based (Next/Nuxt)');
    check('app/controllers', 'Rails MVC');
    check('app/models', 'Rails models');
    check('src/main/java', 'Maven standard');
    check('src/main/kotlin', 'Kotlin source');
    check('src/main/resources', 'Java resources');
    check('src/main/resources/mapper', 'MyBatis mappers');
    check('src/main/resources/db/migration', 'Flyway migrations');
    check('cmd', 'Go cmd pattern');
    check('internal', 'Go internal pattern');
    check('pkg', 'Go pkg pattern');
    check('apps', 'Monorepo apps');
    check('libs', 'Monorepo libs');
    check('packages', 'Monorepo packages');

    return patterns.slice(0, 6); // cap
  }

  private detectFileNaming(): string {
    try {
      const srcDir = fs.existsSync(path.join(this.root, 'src'))
        ? path.join(this.root, 'src')
        : this.root;
      const files = fs.readdirSync(srcDir).filter(f => !f.startsWith('.'));
      const sample = files.slice(0, 20).map(f => path.parse(f).name);

      let kebab = 0, camel = 0, snake = 0, pascal = 0;
      for (const name of sample) {
        if (name.includes('-')) { kebab++; }
        else if (name.includes('_')) { snake++; }
        else if (name[0] === name[0].toUpperCase() && name.length > 1) { pascal++; }
        else if (/[a-z][A-Z]/.test(name)) { camel++; }
      }

      const max = Math.max(kebab, camel, snake, pascal);
      if (max === 0) { return 'mixed'; }
      if (max === kebab) { return 'kebab-case'; }
      if (max === snake) { return 'snake_case'; }
      if (max === pascal) { return 'PascalCase'; }
      return 'camelCase';
    } catch { return 'unknown'; }
  }

  private detectEntryPoints(language: string, framework: string): string[] {
    const entries: string[] = [];
    const check = (f: string) => {
      if (fs.existsSync(path.join(this.root, f))) { entries.push(f); }
    };

    check('src/index.ts');
    check('src/index.js');
    check('src/main.ts');
    check('src/main.js');
    check('src/app.ts');
    check('src/app.js');
    check('src/server.ts');
    check('src/extension.ts');
    check('pages/_app.tsx');
    check('app/layout.tsx');
    check('config/routes.rb');
    check('manage.py');
    check('main.go');
    check('cmd/main.go');
    check('Program.cs');
    // Java / JVM entry points
    check('src/main/resources/application.properties');
    check('src/main/resources/application.yml');
    check('src/main/resources/application.yaml');
    check('src/main/resources/bootstrap.yml');

    return entries.slice(0, 5);
  }
}
