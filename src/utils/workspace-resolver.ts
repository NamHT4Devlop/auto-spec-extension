/**
 * workspace-resolver.ts — Multi-Root & Monorepo Workspace Support
 *
 * Handles 4 workspace scenarios:
 *   1. Single repo (1 workspaceFolder with .git) — use directly
 *   2. Multi-root workspace (N workspaceFolders) — show picker
 *   3. Monorepo (nx/turbo/lerna/pnpm) — detect packages, scope commands
 *   4. Folder of repos (multiple .git subdirs) — auto-discover, show picker
 *
 * Also loads .autospec.yml for per-project config overrides.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { log } from '../logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ResolvedWorkspace {
  /** Root path for the resolved project */
  root: string;
  /** Display name */
  name: string;
  /** Workspace type */
  type: 'single' | 'multi-root' | 'monorepo-package' | 'subfolder';
  /** If monorepo, the monorepo root (parent of packages) */
  monorepoRoot?: string;
  /** Config overrides from .autospec.yml */
  configOverrides: AutoSpecConfig;
}

export interface AutoSpecConfig {
  language?: string;
  testCommand?: string;
  ignore?: string[];
  knowledgeBasePath?: string;
  sessionsDir?: string;
  monorepo?: {
    packages?: string[];
    sharedKB?: boolean;
  };
  scan?: {
    /** Always use source-only mode — skip README, docs/, .github/, copilot-instructions, etc. */
    excludeDocs?: boolean;
    /** Additional directory names to skip during project scan */
    exclude?: string[];
  };
}

export interface MonorepoInfo {
  tool: string;
  root: string;
  packages: { name: string; path: string }[];
}

// ─── WorkspaceResolver ────────────────────────────────────────────────────────

export class WorkspaceResolver {

  /**
   * Resolve which project root to use. May show a picker if ambiguous.
   * Returns null if user cancels.
   */
  async resolve(): Promise<ResolvedWorkspace | null> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { return null; }

    // Single folder — check for monorepo
    if (folders.length === 1) {
      const root = folders[0].uri.fsPath;
      const mono = this.detectMonorepo(root);

      if (mono && mono.packages.length > 1) {
        // Monorepo — ask user which package (or root)
        return this.pickMonorepoPackage(mono);
      }

      // Single repo
      const config = this.loadConfig(root);
      return { root, name: folders[0].name, type: 'single', configOverrides: config };
    }

    // Multi-root workspace — show picker
    return this.pickWorkspaceFolder(folders);
  }

  /**
   * Quick resolve — returns first workspace folder without showing picker.
   * Falls back for commands that don't need scope selection (e.g., /help).
   */
  resolveQuick(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    return folders?.[0]?.uri.fsPath ?? null;
  }

  // ── Monorepo detection ─────────────────────────────────────────────

  detectMonorepo(root: string): MonorepoInfo | null {
    const has = (f: string) => fs.existsSync(path.join(root, f));

    let tool: string | undefined;
    let packageGlobs: string[] = [];

    if (has('nx.json')) {
      tool = 'Nx';
      try {
        const nxConfig = JSON.parse(fs.readFileSync(path.join(root, 'nx.json'), 'utf-8'));
        // Nx projects can be in apps/, libs/, packages/
        packageGlobs = ['apps/*', 'libs/*', 'packages/*'];
      } catch { packageGlobs = ['apps/*', 'libs/*']; }
    } else if (has('turbo.json')) {
      tool = 'Turborepo';
      packageGlobs = this.getTurboPackages(root);
    } else if (has('lerna.json')) {
      tool = 'Lerna';
      try {
        const lernaConfig = JSON.parse(fs.readFileSync(path.join(root, 'lerna.json'), 'utf-8'));
        packageGlobs = lernaConfig.packages ?? ['packages/*'];
      } catch { packageGlobs = ['packages/*']; }
    } else if (has('pnpm-workspace.yaml')) {
      tool = 'pnpm workspaces';
      packageGlobs = this.getPnpmWorkspacePackages(root);
    } else if (has('package.json')) {
      // Check for npm/yarn workspaces in package.json
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
        if (pkg.workspaces) {
          tool = 'npm workspaces';
          packageGlobs = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces.packages ?? [];
        }
      } catch { /* not a workspaces project */ }
    }

    if (!tool) { return null; }

    // Resolve globs to actual packages
    const packages = this.resolvePackageGlobs(root, packageGlobs);

    if (packages.length === 0) { return null; }

    log(`📦 WorkspaceResolver: detected ${tool} monorepo with ${packages.length} packages`);
    return { tool, root, packages };
  }

  // ── Config loading ─────────────────────────────────────────────────

  /**
   * Load .autospec.yml from the project root.
   */
  loadConfig(root: string): AutoSpecConfig {
    const yamlPath = path.join(root, '.autospec.yml');
    const jsonPath = path.join(root, '.autospec.json');

    // Try YAML first (simple key-value parser — no external dep)
    if (fs.existsSync(yamlPath)) {
      try {
        return this.parseSimpleYaml(fs.readFileSync(yamlPath, 'utf-8'));
      } catch (err) {
        log(`⚠️ WorkspaceResolver: failed to parse .autospec.yml — ${err}`);
      }
    }

    // Fallback to JSON
    if (fs.existsSync(jsonPath)) {
      try {
        return JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      } catch { /* ignore */ }
    }

    return {};
  }

  /**
   * Apply config overrides to VS Code settings (non-persistent, workspace-level).
   */
  applyConfigOverrides(config: AutoSpecConfig): void {
    const cfg = vscode.workspace.getConfiguration('autoSpecKit');

    if (config.language) {
      log(`📦 Config override: language → ${config.language}`);
    }
    if (config.testCommand) {
      log(`📦 Config override: testCommand → ${config.testCommand}`);
    }
    if (config.knowledgeBasePath) {
      log(`📦 Config override: knowledgeBasePath → ${config.knowledgeBasePath}`);
    }
    // Note: we don't actually update VS Code settings — we return the overrides
    // and the caller merges them at runtime.
  }

  /**
   * Get effective config value: .autospec.yml override > VS Code setting > default.
   */
  getEffectiveConfig(root: string): {
    language: string;
    testCommand: string;
    knowledgeBasePath: string;
    sessionsDir: string;
    ignore: string[];
    scan: { excludeDocs: boolean; exclude: string[] };
  } {
    const overrides = this.loadConfig(root);
    const cfg = vscode.workspace.getConfiguration('autoSpecKit');

    return {
      language: overrides.language ?? cfg.get<string>('language', 'typescript'),
      testCommand: overrides.testCommand ?? cfg.get<string>('testCommand', ''),
      knowledgeBasePath: overrides.knowledgeBasePath ?? cfg.get<string>('knowledgeBasePath', 'knowledge-base'),
      sessionsDir: overrides.sessionsDir ?? cfg.get<string>('sessionsDir', 'spec-kit-sessions'),
      ignore: overrides.ignore ?? [],
      scan: {
        excludeDocs: overrides.scan?.excludeDocs ?? false,
        exclude: overrides.scan?.exclude ?? [],
      },
    };
  }

  // ── Pickers ────────────────────────────────────────────────────────

  private async pickWorkspaceFolder(
    folders: readonly vscode.WorkspaceFolder[],
  ): Promise<ResolvedWorkspace | null> {
    const items = folders.map(f => ({
      label: f.name,
      description: f.uri.fsPath,
      folder: f,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      title: '📂 Which project?',
      placeHolder: 'Select the workspace folder to target',
    });

    if (!picked) { return null; }

    const root = picked.folder.uri.fsPath;
    const config = this.loadConfig(root);
    return { root, name: picked.label, type: 'multi-root', configOverrides: config };
  }

  private async pickMonorepoPackage(mono: MonorepoInfo): Promise<ResolvedWorkspace | null> {
    const items = [
      { label: '📦 Entire monorepo (root)', description: mono.root, isRoot: true, pkgPath: mono.root },
      ...mono.packages.map(p => ({
        label: `  ${p.name}`,
        description: p.path,
        isRoot: false,
        pkgPath: p.path,
      })),
    ];

    const picked = await vscode.window.showQuickPick(items, {
      title: `📦 ${mono.tool} Monorepo — Which package?`,
      placeHolder: 'Select a package or the entire monorepo',
    });

    if (!picked) { return null; }

    const root = picked.pkgPath;
    const config = this.loadConfig(root);
    return {
      root,
      name: picked.label.trim(),
      type: picked.isRoot ? 'single' : 'monorepo-package',
      monorepoRoot: mono.root,
      configOverrides: config,
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private resolvePackageGlobs(root: string, globs: string[]): { name: string; path: string }[] {
    const packages: { name: string; path: string }[] = [];

    for (const glob of globs) {
      // Simple glob: "packages/*" or "apps/*"
      const parts = glob.split('/');
      if (parts.length !== 2 || parts[1] !== '*') { continue; }

      const dir = path.join(root, parts[0]);
      if (!fs.existsSync(dir)) { continue; }

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) { continue; }
        const pkgPath = path.join(dir, entry.name);

        // Must have package.json, go.mod, pom.xml, etc.
        const hasManifest = fs.existsSync(path.join(pkgPath, 'package.json'))
          || fs.existsSync(path.join(pkgPath, 'go.mod'))
          || fs.existsSync(path.join(pkgPath, 'pom.xml'))
          || fs.existsSync(path.join(pkgPath, 'Cargo.toml'));

        if (hasManifest) {
          let name = entry.name;
          try {
            const pkg = JSON.parse(fs.readFileSync(path.join(pkgPath, 'package.json'), 'utf-8'));
            name = pkg.name ?? entry.name;
          } catch { /* use folder name */ }
          packages.push({ name, path: pkgPath });
        }
      }
    }

    return packages;
  }

  private getTurboPackages(root: string): string[] {
    // Turborepo uses package.json workspaces
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
      return Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages ?? ['packages/*'];
    } catch { return ['packages/*', 'apps/*']; }
  }

  private getPnpmWorkspacePackages(root: string): string[] {
    try {
      const content = fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf-8');
      // Simple YAML list parser for "packages:" section
      const match = content.match(/packages:\s*\n((?:\s+-\s+.+\n?)+)/);
      if (match) {
        return match[1].split('\n')
          .map(l => l.trim().replace(/^-\s*['"]?/, '').replace(/['"]?\s*$/, ''))
          .filter(l => l.length > 0);
      }
    } catch { /* ignore */ }
    return ['packages/*'];
  }

  /**
   * Minimal YAML parser for .autospec.yml (handles flat key-value + arrays).
   * No external dependency needed.
   */
  private parseSimpleYaml(content: string): AutoSpecConfig {
    const config: any = {};
    const lines = content.split('\n');
    let currentKey = '';
    let currentArray: string[] | null = null;

    for (const rawLine of lines) {
      const line = rawLine.replace(/#.*$/, ''); // strip comments
      if (line.trim().length === 0) { continue; }

      // Array item
      if (line.match(/^\s+-\s+/) && currentKey) {
        const value = line.trim().replace(/^-\s*['"]?/, '').replace(/['"]?\s*$/, '');
        if (!currentArray) { currentArray = []; }
        currentArray.push(value);
        config[currentKey] = currentArray;
        continue;
      }

      // Key-value
      const kvMatch = line.match(/^(\w[\w.]*)\s*:\s*(.*)$/);
      if (kvMatch) {
        // Save previous array if any
        currentArray = null;
        currentKey = kvMatch[1];
        const value = kvMatch[2].trim().replace(/^['"]|['"]$/g, '');

        if (value.length > 0) {
          // Scalar value
          if (value === 'true') { config[currentKey] = true; }
          else if (value === 'false') { config[currentKey] = false; }
          else if (/^\d+$/.test(value)) { config[currentKey] = parseInt(value); }
          else { config[currentKey] = value; }
        }
        // If value is empty, next lines might be array items
      }
    }

    return config;
  }
}
