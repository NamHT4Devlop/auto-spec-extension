"use strict";
/**
 * git-utils.ts
 * Utilities for loading git context during code review.
 * All functions are safe — they return empty strings on failure (git not available, not a repo, etc.)
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.isGitRepo = isGitRepo;
exports.getCurrentBranch = getCurrentBranch;
exports.getDefaultBranch = getDefaultBranch;
exports.getRecentLog = getRecentLog;
exports.getDiffVsDefault = getDiffVsDefault;
exports.getDiffWorkingTree = getDiffWorkingTree;
exports.getChangedFiles = getChangedFiles;
exports.loadGitContext = loadGitContext;
exports.formatGitContextForPrompt = formatGitContextForPrompt;
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const logger_1 = require("../logger");
// ─── Helpers ─────────────────────────────────────────────────────────────────
function run(cmd, cwd) {
    try {
        return (0, child_process_1.execSync)(cmd, {
            cwd,
            encoding: 'utf-8',
            timeout: 8000,
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
    }
    catch {
        return '';
    }
}
// ─── Exported functions ───────────────────────────────────────────────────────
function isGitRepo(workspaceRoot) {
    return run('git rev-parse --is-inside-work-tree', workspaceRoot) === 'true';
}
function getCurrentBranch(workspaceRoot) {
    return run('git branch --show-current', workspaceRoot) || 'unknown';
}
/**
 * Detect default branch: tries 'main' then 'master' then 'develop'.
 * Falls back to HEAD~1 so we always have something to diff against.
 */
function getDefaultBranch(workspaceRoot) {
    for (const branch of ['main', 'master', 'develop']) {
        const exists = run(`git rev-parse --verify ${branch}`, workspaceRoot);
        if (exists) {
            return branch;
        }
    }
    // If no named default branch, use parent commit
    const parentExists = run('git rev-parse --verify HEAD~1', workspaceRoot);
    return parentExists ? 'HEAD~1' : 'HEAD';
}
/** Last N commit subjects */
function getRecentLog(workspaceRoot, n = 10) {
    return run(`git log --oneline -${n}`, workspaceRoot);
}
/** git diff between defaultBranch and HEAD for a specific file (or all files if relPath omitted) */
function getDiffVsDefault(workspaceRoot, defaultBranch, relPath) {
    const pathArg = relPath ? `-- "${relPath}"` : '';
    // Try three-dot diff (changes on current branch only)
    const diff = run(`git diff ${defaultBranch}...HEAD ${pathArg}`, workspaceRoot);
    if (diff) {
        return diff;
    }
    // Fallback: two-dot diff
    return run(`git diff ${defaultBranch} HEAD ${pathArg}`, workspaceRoot);
}
/** git diff between HEAD commit and working tree (uncommitted changes) */
function getDiffWorkingTree(workspaceRoot, relPath) {
    const pathArg = relPath ? `-- "${relPath}"` : '';
    const staged = run(`git diff --cached ${pathArg}`, workspaceRoot);
    const unstaged = run(`git diff ${pathArg}`, workspaceRoot);
    return [staged, unstaged].filter(Boolean).join('\n');
}
/** List files changed between defaultBranch and HEAD */
function getChangedFiles(workspaceRoot, defaultBranch) {
    const output = run(`git diff --name-only ${defaultBranch}...HEAD`, workspaceRoot);
    if (!output) {
        return [];
    }
    return output.split('\n').filter(Boolean);
}
/**
 * Load full git context for a set of file paths (relative to workspaceRoot).
 * Called before STEP 05 so the reviewer knows what existed before and what changed.
 */
function loadGitContext(workspaceRoot, relPaths) {
    if (!isGitRepo(workspaceRoot)) {
        (0, logger_1.log)('ℹ  Not a git repo — skipping git context for review');
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
    const changedFiles = getChangedFiles(workspaceRoot, defaultBranch);
    const recentLog = getRecentLog(workspaceRoot);
    (0, logger_1.log)(`ℹ  Git context: branch=${currentBranch}, default=${defaultBranch}, changed=${changedFiles.length} files`);
    const fileContexts = relPaths.map(relPath => {
        const absPath = path.join(workspaceRoot, relPath);
        const existed = fs.existsSync(absPath);
        return {
            relPath,
            currentContent: existed ? loadCurrentContent(workspaceRoot, relPath) : '',
            diffVsDefault: getDiffVsDefault(workspaceRoot, defaultBranch, relPath),
            diffWorkingTree: getDiffWorkingTree(workspaceRoot, relPath),
            existed,
        };
    });
    return { currentBranch, defaultBranch, changedFiles, recentLog, fileContexts };
}
/** Load current file content from disk (capped at 400 lines to avoid token overflow) */
function loadCurrentContent(workspaceRoot, relPath) {
    try {
        const absPath = path.join(workspaceRoot, relPath);
        if (!fs.existsSync(absPath)) {
            return '';
        }
        const lines = fs.readFileSync(absPath, 'utf-8').split('\n');
        if (lines.length > 400) {
            return lines.slice(0, 400).join('\n') + `\n... (truncated — ${lines.length} total lines)`;
        }
        return lines.join('\n');
    }
    catch {
        return '';
    }
}
/**
 * Format git context as a markdown block for injection into review prompts.
 * Keeps output concise — diff is most valuable, full content only for small files.
 */
function formatGitContextForPrompt(ctx) {
    if (ctx.currentBranch === 'unknown' && !ctx.fileContexts.length) {
        return '(Git context not available — not a git repository)';
    }
    const lines = [];
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
            fc.diffVsDefault.split('\n').slice(0, 200).join('\n')}\n\`\`\``);
        }
        else if (fc.existed) {
            lines.push(`_(no diff vs ${ctx.defaultBranch} — file unchanged on this branch)_`);
        }
        if (fc.diffWorkingTree) {
            lines.push(`\n**Uncommitted changes (working tree):**\n\`\`\`diff\n${fc.diffWorkingTree.split('\n').slice(0, 100).join('\n')}\n\`\`\``);
        }
        if (fc.existed && !fc.diffVsDefault && fc.currentContent) {
            // Show current content only if there's no diff (file unchanged — just for context)
            const preview = fc.currentContent.split('\n').slice(0, 60).join('\n');
            lines.push(`\n**Current content (preview):**\n\`\`\`\n${preview}\n\`\`\``);
        }
    }
    return lines.join('\n');
}
