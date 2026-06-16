/**
 * git-utils.ts
 * Utilities for loading git context during code review.
 * All functions are safe — they return empty strings on failure (git not available, not a repo, etc.)
 */

import { execFileSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { log } from '../logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FileContext {
  relPath: string;
  /** Content of the file as it currently exists on disk (before applying new code) */
  currentContent: string;
  /** git diff between default branch and HEAD for this file */
  diffVsDefault: string;
  /** git diff between HEAD and working tree (staged + unstaged) for this file */
  diffWorkingTree: string;
  /** true if file already existed before this task */
  existed: boolean;
}

export interface GitContext {
  currentBranch: string;
  defaultBranch: string;
  /** Files changed between defaultBranch and HEAD */
  changedFiles: string[];
  /** Short git log (last 10 commits) */
  recentLog: string;
  /** Per-file context for files the task touches */
  fileContexts: FileContext[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Run `git` with an explicit argument array (no shell).
 * Using execFileSync prevents shell interpretation of branch names / file paths,
 * eliminating command-injection via untrusted ref or path values.
 */
function git(args: string[], cwd: string): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      timeout: 8000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

// ─── Exported functions ───────────────────────────────────────────────────────

export function isGitRepo(workspaceRoot: string): boolean {
  return git(['rev-parse', '--is-inside-work-tree'], workspaceRoot) === 'true';
}

export function getCurrentBranch(workspaceRoot: string): string {
  return git(['branch', '--show-current'], workspaceRoot) || 'unknown';
}

/**
 * Detect default branch: tries 'main' then 'master' then 'develop'.
 * Falls back to HEAD~1 so we always have something to diff against.
 */
export function getDefaultBranch(workspaceRoot: string): string {
  for (const branch of ['main', 'master', 'develop']) {
    const exists = git(['rev-parse', '--verify', branch], workspaceRoot);
    if (exists) { return branch; }
  }
  // If no named default branch, use parent commit
  const parentExists = git(['rev-parse', '--verify', 'HEAD~1'], workspaceRoot);
  return parentExists ? 'HEAD~1' : 'HEAD';
}

/** Last N commit subjects */
export function getRecentLog(workspaceRoot: string, n = 10): string {
  return git(['log', '--oneline', `-${n}`], workspaceRoot);
}

/** git diff between defaultBranch and HEAD for a specific file (or all files if relPath omitted) */
export function getDiffVsDefault(workspaceRoot: string, defaultBranch: string, relPath?: string): string {
  const pathArgs = relPath ? ['--', relPath] : [];
  // Try three-dot diff (changes on current branch only)
  const diff = git(['diff', `${defaultBranch}...HEAD`, ...pathArgs], workspaceRoot);
  if (diff) { return diff; }
  // Fallback: two-dot diff
  return git(['diff', defaultBranch, 'HEAD', ...pathArgs], workspaceRoot);
}

/** git diff between HEAD commit and working tree (uncommitted changes) */
export function getDiffWorkingTree(workspaceRoot: string, relPath?: string): string {
  const pathArgs = relPath ? ['--', relPath] : [];
  const staged   = git(['diff', '--cached', ...pathArgs], workspaceRoot);
  const unstaged = git(['diff', ...pathArgs], workspaceRoot);
  return [staged, unstaged].filter(Boolean).join('\n');
}

/** List files changed between defaultBranch and HEAD */
export function getChangedFiles(workspaceRoot: string, defaultBranch: string): string[] {
  const output = git(['diff', '--name-only', `${defaultBranch}...HEAD`], workspaceRoot);
  if (!output) { return []; }
  return output.split('\n').filter(Boolean);
}

/**
 * Load full git context for a set of file paths (relative to workspaceRoot).
 * Called before STEP 05 so the reviewer knows what existed before and what changed.
 */
export function loadGitContext(workspaceRoot: string, relPaths: string[]): GitContext {
  if (!isGitRepo(workspaceRoot)) {
    log('ℹ  Not a git repo — skipping git context for review');
    return {
      currentBranch: 'unknown',
      defaultBranch: 'unknown',
      changedFiles: [],
      recentLog: '',
      fileContexts: relPaths.map(p => ({
        relPath: p,
        currentContent: loadCurrentContent(workspaceRoot, p),
        diffVsDefault: '',
        diffWorkingTree: '',
        existed: fs.existsSync(path.join(workspaceRoot, p)),
      })),
    };
  }

  const currentBranch = getCurrentBranch(workspaceRoot);
  const defaultBranch = getDefaultBranch(workspaceRoot);
  const changedFiles  = getChangedFiles(workspaceRoot, defaultBranch);
  const recentLog     = getRecentLog(workspaceRoot);

  log(`ℹ  Git context: branch=${currentBranch}, default=${defaultBranch}, changed=${changedFiles.length} files`);

  const fileContexts: FileContext[] = relPaths.map(relPath => {
    const absPath = path.join(workspaceRoot, relPath);
    const existed = fs.existsSync(absPath);
    return {
      relPath,
      currentContent: existed ? loadCurrentContent(workspaceRoot, relPath) : '',
      diffVsDefault:  getDiffVsDefault(workspaceRoot, defaultBranch, relPath),
      diffWorkingTree: getDiffWorkingTree(workspaceRoot, relPath),
      existed,
    };
  });

  return { currentBranch, defaultBranch, changedFiles, recentLog, fileContexts };
}

/** Load current file content from disk (capped at 400 lines to avoid token overflow) */
function loadCurrentContent(workspaceRoot: string, relPath: string): string {
  try {
    const absPath = path.join(workspaceRoot, relPath);
    if (!fs.existsSync(absPath)) { return ''; }
    const lines = fs.readFileSync(absPath, 'utf-8').split('\n');
    if (lines.length > 400) {
      return lines.slice(0, 400).join('\n') + `\n... (truncated — ${lines.length} total lines)`;
    }
    return lines.join('\n');
  } catch {
    return '';
  }
}

/**
 * Format git context as a markdown block for injection into review prompts.
 * Keeps output concise — diff is most valuable, full content only for small files.
 */
export function formatGitContextForPrompt(ctx: GitContext): string {
  if (ctx.currentBranch === 'unknown' && !ctx.fileContexts.length) {
    return '(Git context not available — not a git repository)';
  }

  const lines: string[] = [];
  lines.push(`**Branch:** \`${ctx.currentBranch}\`  |  **Default branch:** \`${ctx.defaultBranch}\``);
  lines.push(`**Changed files (vs ${ctx.defaultBranch}):** ${ctx.changedFiles.length > 0 ? ctx.changedFiles.join(', ') : 'none detected'}`);

  if (ctx.recentLog) {
    lines.push(`\n**Recent commits:**\n\`\`\`\n${ctx.recentLog}\n\`\`\``);
  }

  for (const fc of ctx.fileContexts) {
    lines.push(`\n---\n### File: \`${fc.relPath}\` (${fc.existed ? 'existing' : 'NEW FILE'})`);

    if (fc.diffVsDefault) {
      lines.push(`\n**Diff vs \`${ctx.defaultBranch}\`** (what this branch changed):\n\`\`\`diff\n${
        // Cap diff at 200 lines to avoid token overflow
        fc.diffVsDefault.split('\n').slice(0, 200).join('\n')
      }\n\`\`\``);
    } else if (fc.existed) {
      lines.push(`_(no diff vs ${ctx.defaultBranch} — file unchanged on this branch)_`);
    }

    if (fc.diffWorkingTree) {
      lines.push(`\n**Uncommitted changes (working tree):**\n\`\`\`diff\n${
        fc.diffWorkingTree.split('\n').slice(0, 100).join('\n')
      }\n\`\`\``);
    }

    if (fc.existed && !fc.diffVsDefault && fc.currentContent) {
      // Show current content only if there's no diff (file unchanged — just for context)
      const preview = fc.currentContent.split('\n').slice(0, 60).join('\n');
      lines.push(`\n**Current content (preview):**\n\`\`\`\n${preview}\n\`\`\``);
    }
  }

  return lines.join('\n');
}
