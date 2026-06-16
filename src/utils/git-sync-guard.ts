/**
 * git-sync-guard.ts — Read-Only Git Sync for Auto Spec Kit
 *
 * Runs before every command to ensure the workspace has the latest code.
 * Operations:
 *   - git fetch --all --prune
 *   - git pull --ff-only (fast-forward only — never creates merge commits)
 *   - Detect if source files changed → trigger KB update
 *
 * SAFETY: This module NEVER runs git push, git commit, or any write
 * operation that affects the remote. All operations are strictly read-only.
 */

import * as vscode from 'vscode';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { log } from '../logger';

export interface SyncResult {
  fetched: boolean;
  pulled: boolean;
  newCommits: number;
  changedFiles: string[];
  kbNeedsUpdate: boolean;
  error?: string;
}

export class GitSyncGuard {

  /** Source extensions that matter for KB staleness detection */
  private static readonly SOURCE_EXTS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.go', '.java', '.cs', '.rs', '.rb', '.php',
    '.vue', '.svelte', '.astro',
    '.sql', '.graphql', '.gql', '.prisma',
    '.yaml', '.yml', '.toml',
    '.sh', '.bash',
  ]);

  /** Directories to ignore when checking changed files */
  private static readonly IGNORE_DIRS = new Set([
    'node_modules', 'dist', 'build', 'out', 'coverage',
    '.next', '.nuxt', '__pycache__', 'vendor', 'target',
    'spec-kit-sessions', 'knowledge-base',
  ]);

  /**
   * Check if the given directory is a git repo.
   */
  static isGitRepo(root: string): boolean {
    try {
      execSync('git rev-parse --is-inside-work-tree', {
        cwd: root,
        stdio: 'pipe',
        timeout: 5000,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Run the full sync cycle: fetch → pull → detect changes.
   * Returns a SyncResult describing what happened.
   */
  static async sync(root: string): Promise<SyncResult> {
    const result: SyncResult = {
      fetched: false,
      pulled: false,
      newCommits: 0,
      changedFiles: [],
      kbNeedsUpdate: false,
    };

    if (!this.isGitRepo(root)) {
      result.error = 'Not a git repository';
      return result;
    }

    // ── 1. Capture HEAD before sync ──
    const headBefore = this.getHead(root);

    // ── 2. Fetch all remotes ──
    try {
      execSync('git fetch --all --prune', {
        cwd: root,
        stdio: 'pipe',
        timeout: 30_000,
      });
      result.fetched = true;
      log('🔄 GitSync: fetch --all --prune done');
    } catch (err: any) {
      // Fetch failure is non-fatal — might be offline
      log(`⚠️ GitSync: fetch failed (offline?) — ${err.message?.split('\n')[0]}`);
      result.error = `Fetch failed: ${err.message?.split('\n')[0]}`;
      return result;
    }

    // ── 3. Pull with fast-forward only ──
    try {
      const pullOutput = execSync('git pull --ff-only', {
        cwd: root,
        stdio: 'pipe',
        timeout: 30_000,
      }).toString().trim();

      result.pulled = true;

      if (pullOutput.includes('Already up to date')) {
        log('✅ GitSync: already up to date');
      } else {
        log(`✅ GitSync: pulled new changes`);
      }
    } catch (err: any) {
      const msg = err.message?.split('\n')[0] ?? 'unknown error';
      // ff-only fails if local has diverged — this is expected, don't force
      if (msg.includes('Not possible to fast-forward')) {
        log('⚠️ GitSync: local branch has diverged — skipping pull (ff-only)');
        result.error = 'Branch diverged — manual merge needed';
      } else {
        log(`⚠️ GitSync: pull failed — ${msg}`);
        result.error = `Pull failed: ${msg}`;
      }
    }

    // ── 4. Detect what changed ──
    const headAfter = this.getHead(root);

    if (headBefore && headAfter && headBefore !== headAfter) {
      try {
        const diffOutput = execSync(
          `git diff --name-only ${headBefore}..${headAfter}`,
          { cwd: root, stdio: 'pipe', timeout: 10_000 },
        ).toString().trim();

        if (diffOutput) {
          result.changedFiles = diffOutput.split('\n').filter(Boolean);
          result.newCommits = this.countCommits(root, headBefore, headAfter);
          result.kbNeedsUpdate = this.hasSourceChanges(result.changedFiles);

          log(`📊 GitSync: ${result.newCommits} new commit(s), ${result.changedFiles.length} file(s) changed`);
          if (result.kbNeedsUpdate) {
            log('📚 GitSync: source files changed — KB update recommended');
          }
        }
      } catch {
        log('⚠️ GitSync: failed to diff changes');
      }
    }

    return result;
  }

  /**
   * Quick check: are there remote changes available without pulling?
   */
  static hasRemoteChanges(root: string): boolean {
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: root, stdio: 'pipe', timeout: 5000,
      }).toString().trim();

      const local = execSync(`git rev-parse ${branch}`, {
        cwd: root, stdio: 'pipe', timeout: 5000,
      }).toString().trim();

      const remote = execSync(`git rev-parse origin/${branch}`, {
        cwd: root, stdio: 'pipe', timeout: 5000,
      }).toString().trim();

      return local !== remote;
    } catch {
      return false;
    }
  }

  /**
   * Check if KB needs update by comparing last KB generation time
   * against last source file modification time.
   */
  static isKBStale(root: string, kbRelPath: string): boolean {
    const kbDir = path.join(root, kbRelPath);
    if (!fs.existsSync(kbDir)) { return true; } // No KB = needs generation

    try {
      // Get KB last modified time
      const kbStat = fs.statSync(kbDir);
      const kbMtime = kbStat.mtimeMs;

      // Check if any source file is newer than KB
      return this.hasNewerSourceFiles(root, kbMtime);
    } catch {
      return true;
    }
  }

  // ── Private helpers ────────────────────────────────────────────────

  private static getHead(root: string): string | null {
    try {
      return execSync('git rev-parse HEAD', {
        cwd: root, stdio: 'pipe', timeout: 5000,
      }).toString().trim();
    } catch {
      return null;
    }
  }

  private static countCommits(root: string, from: string, to: string): number {
    try {
      const output = execSync(`git rev-list --count ${from}..${to}`, {
        cwd: root, stdio: 'pipe', timeout: 5000,
      }).toString().trim();
      return parseInt(output, 10) || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Check if any changed files are source files (not just docs/config).
   */
  private static hasSourceChanges(files: string[]): boolean {
    return files.some(f => {
      const ext = path.extname(f).toLowerCase();
      const parts = f.split('/');
      const inIgnoredDir = parts.some(p => this.IGNORE_DIRS.has(p));
      return !inIgnoredDir && this.SOURCE_EXTS.has(ext);
    });
  }

  /**
   * Walk source tree and check if any file is newer than the given timestamp.
   */
  private static hasNewerSourceFiles(root: string, sinceMs: number, dir?: string, depth = 0): boolean {
    if (depth > 6) { return false; }
    const target = dir ?? root;

    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(target, { withFileTypes: true }); }
    catch { return false; }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) { continue; }

      if (entry.isDirectory()) {
        if (this.IGNORE_DIRS.has(entry.name)) { continue; }
        if (this.hasNewerSourceFiles(root, sinceMs, path.join(target, entry.name), depth + 1)) {
          return true;
        }
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (!this.SOURCE_EXTS.has(ext)) { continue; }

      try {
        const stat = fs.statSync(path.join(target, entry.name));
        if (stat.mtimeMs > sinceMs) { return true; }
      } catch { continue; }
    }

    return false;
  }
}
