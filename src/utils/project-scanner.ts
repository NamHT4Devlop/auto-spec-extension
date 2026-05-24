import * as fs from 'fs';
import * as path from 'path';
import { log } from '../logger';

export function scanProject(root: string): string {
  const parts: string[] = [];
  const MAX_FILE  = 40_000;   // 40KB per file
  const MAX_TOTAL = 600_000;  // 600KB total context
  let totalSize   = 0;

  const SKIP_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', 'out', '__pycache__',
    '.next', '.nuxt', 'coverage', 'spec-kit-sessions', 'knowledge-base',
    '.vscode', '.idea', 'vendor', 'target', '.gradle',
  ]);
  const SKIP_EXTS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
    '.woff', '.woff2', '.ttf', '.eot', '.otf',
    '.lock', '.map', '.min.js', '.min.css',
    '.zip', '.gz', '.tar', '.jar', '.class', '.pyc',
  ]);
  // Config / manifest files always included first
  const PRIORITY = [
    'package.json', 'requirements.txt', 'go.mod', 'pom.xml', 'Gemfile',
    'tsconfig.json', 'webpack.config.js', 'vite.config.ts', 'vite.config.js',
    'babel.config.js', '.babelrc', 'jest.config.ts', 'jest.config.js',
    'docker-compose.yml', 'docker-compose.yaml', 'Dockerfile',
    '.env.example', '.env.sample', 'README.md', 'Makefile',
    'pyproject.toml', 'setup.py', 'setup.cfg', 'cargo.toml',
  ];

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
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.go', '.java', '.cs', '.rs', '.rb', '.php',
    '.vue', '.svelte', '.astro',
    '.sql', '.graphql', '.gql', '.prisma',
    '.yaml', '.yml', '.toml', '.env.example',
    '.sh', '.bash',
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
