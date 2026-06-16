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
}

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
  const { excludeDocs = false, excludeExtra = [] } = options;

  const parts: string[] = [];
  const MAX_FILE  = 40_000;   // 40KB per file
  const MAX_TOTAL = 600_000;  // 600KB total context
  let totalSize   = 0;

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
  walkTree(root);
  parts.push(`## DIRECTORY TREE\n\`\`\`\n${root}\n${treeLines.join('\n')}\n\`\`\``);

  // ── 2. Priority files (always included) ───────────────────────
  const seen = new Set<string>();
  for (const fname of PRIORITY) {
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

  const walkSrc = (dir: string, depth = 0) => {
    if (depth > 6 || totalSize >= MAX_TOTAL) { return; }
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) { walkSrc(full, depth + 1); }
        continue;
      }
      if (seen.has(full)) { continue; }
      // In source-only mode, skip any doc files by name
      if (excludeDocs && DOC_FILES.has(entry.name.toLowerCase())) { continue; }
      const ext = path.extname(entry.name).toLowerCase();
      if (SKIP_EXTS.has(ext)) { continue; }
      if (!SOURCE_EXTS.has(ext)) { continue; }
      if (totalSize >= MAX_TOTAL) { break; }

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
  };
  walkSrc(root);

  log(`   → ${seen.size} files scanned, ${(totalSize / 1024).toFixed(0)}KB total`);
  return parts.join('\n\n---\n\n');
}
