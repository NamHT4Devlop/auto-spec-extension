import * as fs from 'fs';
import * as path from 'path';
import { log } from '../logger';

/** Options for project scanning */
export interface ScanOptions {
  /** Skip all documentation files — only scan actual source code.
   *  Excludes: README, CONTRIBUTING, CHANGELOG, docs/, .github/, copilot-instructions, etc.
   *  Use this when existing docs are outdated and you want a clean KB from code alone. */
  excludeDocs?: boolean;
  /** Additional glob-style directory names to skip during scan */
  excludeExtra?: string[];
  /** Max bytes captured per file (default 40KB) */
  maxFileBytes?: number;
  /** Max total bytes captured for the whole scan (default 600KB) */
  maxTotalBytes?: number;
  /** Restrict the source walk to this sub-directory (relative to root). Used for per-module scans. */
  subDir?: string;
  /** Skip the directory-tree section (used for per-module scans to save tokens) */
  skipTree?: boolean;
}

/** A detected module/domain within the project. */
export interface ProjectModule {
  /** Display name (directory name) */
  name: string;
  /** Path relative to project root */
  relDir: string;
  /** Number of source files found under it */
  fileCount: number;
}

// Directories that are NOT business modules (framework/infra plumbing).
const NON_MODULE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '__pycache__', '.next', '.nuxt',
  'coverage', 'spec-kit-sessions', 'knowledge-base', '.vscode', '.idea', 'vendor',
  'target', '.gradle', 'test', 'tests', '__tests__', 'mocks', '__mocks__',
  'node', 'bin', 'obj', 'public', 'static', 'assets', 'resources',
]);

/**
 * Business-relevance rank for a file path (lower = more important).
 * Used to keep the most meaningful code when the byte cap forces truncation.
 */
function businessRank(relLower: string): number {
  if (/(service|controller|handler|resolver|usecase|use-case|command|query|domain|workflow|process|saga|orchestrat|validator|policy|rule|guard|interceptor|middleware|gateway|facade)/.test(relLower)) {
    return 0; // core business logic
  }
  if (/(entity|model|schema|migration|repository|dao|mapper|dto|aggregate|event)/.test(relLower)) {
    return 1; // domain data layer
  }
  if (/(\.test\.|\.spec\.|__tests__|_test\.|tests?\/)/.test(relLower)) {
    return 2; // tests (reveal intent, but bulky)
  }
  if (/(config|util|helper|constant|enum|type|\.properties|\.ya?ml|\.xml|\.json)/.test(relLower)) {
    return 4; // config/util — lowest priority
  }
  return 3; // other source
}

/** Source file extensions (module-scope copy for module discovery). */
const SOURCE_EXTS_EXPORT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.java', '.kt', '.kts', '.scala', '.groovy',
  '.py', '.go', '.cs', '.rs', '.rb', '.php',
  '.vue', '.svelte', '.astro',
  '.sql', '.graphql', '.gql', '.prisma',
]);

/** Documentation files to exclude in source-only mode */
const DOC_FILES = new Set([
  'readme.md', 'readme.txt', 'readme.rst', 'readme',
  'contributing.md', 'contributing.txt',
  'changelog.md', 'changelog.txt', 'changes.md',
  'license.md', 'license.txt', 'license',
  'code_of_conduct.md', 'security.md',
  'authors.md', 'authors.txt',
  'history.md', 'history.txt',
  'copilot-instructions.md',
]);

/** Documentation directories to exclude in source-only mode */
const DOC_DIRS = new Set([
  'docs', 'doc', 'documentation', 'wiki',
  '.github', '.gitlab',
]);

export function scanProject(root: string, options: ScanOptions = {}): string {
  const { excludeDocs = false, excludeExtra = [], subDir, skipTree = false } = options;

  const parts: string[] = [];
  const MAX_FILE  = options.maxFileBytes  ?? 40_000;    // bytes per file
  const MAX_TOTAL = options.maxTotalBytes ?? 600_000;   // total context bytes
  let totalSize   = 0;
  const walkRoot  = subDir ? path.join(root, subDir) : root;

  const SKIP_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', 'out', '__pycache__',
    '.next', '.nuxt', 'coverage', 'spec-kit-sessions', 'knowledge-base',
    '.vscode', '.idea', 'vendor', 'target', '.gradle',
    ...excludeExtra,
  ]);

  // In source-only mode, also skip documentation directories
  if (excludeDocs) {
    for (const d of DOC_DIRS) { SKIP_DIRS.add(d); }
    log('🧹 Source-only mode: skipping documentation files & directories');
  }

  const SKIP_EXTS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
    '.woff', '.woff2', '.ttf', '.eot', '.otf',
    '.lock', '.map', '.min.js', '.min.css',
    '.zip', '.gz', '.tar', '.jar', '.class', '.pyc',
    // In source-only mode, also skip markdown (docs)
    ...(excludeDocs ? ['.md', '.mdx', '.rst', '.adoc'] : []),
  ]);

  // Config / manifest files always included first
  // In source-only mode, remove README.md from priority list
  const PRIORITY_ALL = [
    // JS / TS
    'package.json', 'tsconfig.json', 'webpack.config.js', 'vite.config.ts', 'vite.config.js',
    'babel.config.js', '.babelrc', 'jest.config.ts', 'jest.config.js',
    // Java / JVM
    'pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts',
    'application.properties', 'application.yml', 'application.yaml',
    'bootstrap.properties', 'bootstrap.yml',
    // Python
    'requirements.txt', 'pyproject.toml', 'setup.py', 'setup.cfg',
    // Go / Rust / Ruby
    'go.mod', 'Cargo.toml', 'Gemfile',
    // Infra / Docker
    'docker-compose.yml', 'docker-compose.yaml', 'Dockerfile',
    '.env.example', '.env.sample',
    // DB migrations
    'flyway.conf', 'liquibase.properties',
    // General
    'README.md', 'Makefile',
  ];
  const PRIORITY = excludeDocs
    ? PRIORITY_ALL.filter(f => !DOC_FILES.has(f.toLowerCase()))
    : PRIORITY_ALL;

  // ── 1. Directory tree ──────────────────────────────────────────
  const treeLines: string[] = [];
  const walkTree = (dir: string, prefix = '', depth = 0) => {
    if (depth > 5) { return; }
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    entries = entries.filter(e =>
      !e.name.startsWith('.') || e.name === '.env.example' || e.name === '.env.sample'
    );
    entries.forEach((entry, idx) => {
      const isLast = idx === entries.length - 1;
      treeLines.push(`${prefix}${isLast ? '└── ' : '├── '}${entry.name}`);
      if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
        walkTree(path.join(dir, entry.name), prefix + (isLast ? '    ' : '│   '), depth + 1);
      }
    });
  };
  if (!skipTree) {
    walkTree(walkRoot);
    parts.push(`## DIRECTORY TREE\n\`\`\`\n${walkRoot}\n${treeLines.join('\n')}\n\`\`\``);
  }

  // ── 2. Priority files (always included) ───────────────────────
  const seen = new Set<string>();
  for (const fname of (subDir ? [] : PRIORITY)) {
    const full = path.join(root, fname);
    if (!fs.existsSync(full)) { continue; }
    try {
      let content = fs.readFileSync(full, 'utf-8').trim();
      if (content.length > MAX_FILE) { content = content.slice(0, MAX_FILE) + '\n... [TRUNCATED]'; }
      totalSize += content.length;
      parts.push(`## FILE: ${fname}\n\`\`\`\n${content}\n\`\`\``);
      seen.add(full);
    } catch { /* skip */ }
  }

  // ── 3. Source files (walk, depth-limited) ─────────────────────
  const SOURCE_EXTS = new Set([
    // JS / TS ecosystem
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    // JVM languages
    '.java', '.kt', '.kts', '.scala', '.groovy',
    // Other backend
    '.py', '.go', '.cs', '.rs', '.rb', '.php',
    // Frontend frameworks
    '.vue', '.svelte', '.astro',
    // Data / query
    '.sql', '.graphql', '.gql', '.prisma',
    // Config & markup (critical for Java enterprise: Spring XML, MyBatis, Camel, etc.)
    '.xml', '.json', '.yaml', '.yml', '.toml',
    '.properties', '.cfg', '.conf', '.ini',
    // Templates (Thymeleaf, Freemarker, JSP, ERB)
    '.html', '.ftl', '.jsp', '.erb',
    // Infrastructure as code
    '.proto', '.tf', '.hcl',
    // Shell
    '.sh', '.bash',
    '.env.example',
  ]);

  // Collect ALL candidate source files first, then read them in business-priority
  // order so the byte cap keeps the most meaningful code (not whatever the walk hit first).
  const candidates: string[] = [];
  const collect = (dir: string, depth = 0) => {
    if (depth > 8) { return; }
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) { collect(full, depth + 1); }
        continue;
      }
      if (seen.has(full)) { continue; }
      if (excludeDocs && DOC_FILES.has(entry.name.toLowerCase())) { continue; }
      const ext = path.extname(entry.name).toLowerCase();
      if (SKIP_EXTS.has(ext) || !SOURCE_EXTS.has(ext)) { continue; }
      candidates.push(full);
    }
  };
  collect(walkRoot);

  candidates.sort((a, b) => {
    const ra = businessRank(path.relative(root, a).toLowerCase());
    const rb = businessRank(path.relative(root, b).toLowerCase());
    if (ra !== rb) { return ra - rb; }
    return a.localeCompare(b);
  });

  let truncatedCount = 0;
  for (const full of candidates) {
    if (totalSize >= MAX_TOTAL) { truncatedCount++; continue; }
    try {
      let content = fs.readFileSync(full, 'utf-8').trim();
      if (!content) { continue; }
      if (content.length > MAX_FILE) { content = content.slice(0, MAX_FILE) + '\n... [TRUNCATED]'; }
      totalSize += content.length;
      const rel = path.relative(root, full);
      parts.push(`## FILE: ${rel}\n\`\`\`\n${content}\n\`\`\``);
      seen.add(full);
    } catch { /* skip */ }
  }

  if (truncatedCount > 0) {
    parts.push(`## NOTE\n${truncatedCount} additional source file(s) were omitted due to the ${(MAX_TOTAL / 1024).toFixed(0)}KB scan budget. Increase autoSpecKit.scan.maxTotalKB or rely on per-module KB docs for full coverage.`);
  }

  log(`   → ${seen.size} files scanned, ${(totalSize / 1024).toFixed(0)}KB total${truncatedCount ? ` (${truncatedCount} omitted by budget)` : ''}`);
  return parts.join('\n\n---\n\n');
}

/**
 * Discover business modules: immediate sub-directories of the primary source root(s)
 * that contain a meaningful number of source files. Used for per-module KB generation.
 */
export function discoverModules(root: string, options: ScanOptions = {}): ProjectModule[] {
  const minFiles = 2;
  const sourceRoots = ['src', 'app', 'lib', 'internal', 'pkg', 'cmd', 'modules', 'packages', 'apps', 'services', 'domains']
    .map(d => path.join(root, d))
    .filter(d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
  // Fallback: if none of the conventional roots exist, treat the project root itself.
  const roots = sourceRoots.length ? sourceRoots : [root];

  const countSource = (dir: string, depth = 0): number => {
    if (depth > 6) { return 0; }
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
    let c = 0;
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!NON_MODULE_DIRS.has(e.name) && !e.name.startsWith('.')) { c += countSource(path.join(dir, e.name), depth + 1); }
      } else if (SOURCE_EXTS_EXPORT.has(path.extname(e.name).toLowerCase())) {
        c++;
      }
    }
    return c;
  };

  const modules: ProjectModule[] = [];
  const seenNames = new Set<string>();
  for (const sr of roots) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(sr, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || NON_MODULE_DIRS.has(e.name) || e.name.startsWith('.')) { continue; }
      const dir = path.join(sr, e.name);
      const fileCount = countSource(dir);
      if (fileCount < minFiles) { continue; }
      const relDir = path.relative(root, dir);
      if (seenNames.has(e.name)) { continue; }
      seenNames.add(e.name);
      modules.push({ name: e.name, relDir, fileCount });
    }
  }
  // Largest/most-significant modules first.
  modules.sort((a, b) => b.fileCount - a.fileCount);
  return modules;
}

/** Scan a single module subtree (no tree, no priority manifests) with its own byte budget. */
export function scanModule(root: string, relDir: string, options: ScanOptions = {}): string {
  return scanProject(root, { ...options, subDir: relDir, skipTree: true });
}
