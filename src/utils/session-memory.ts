/**
 * session-memory.ts — Persistent Context Memory for Chat Sessions
 *
 * Problem: VS Code Chat Participant API passes ChatContext.history but
 * Copilot models have token limits. After ~20 turns, early context
 * (requirement, decisions, approved plan) gets truncated.
 *
 * Solution: Maintain a rolling summary of key context, persisted in
 * workspaceState. Each turn appends important info, and old entries
 * are summarized to stay within token budget.
 *
 * Usage:
 *   const memory = new SessionMemory(extensionContext);
 *   memory.startSession('build', 'Add reset password feature');
 *   memory.addDecision('User chose JWT with email OTP');
 *   const ctx = memory.getContextForPrompt(4000); // max 4000 tokens
 */

import * as vscode from 'vscode';
import { log } from '../logger';
import { estimateTokens } from './token-budget';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MemoryEntry {
  timestamp: string;
  type: 'requirement' | 'decision' | 'plan' | 'feedback' | 'error' | 'milestone' | 'preference';
  content: string;
  /** Priority 1-3 (1 = must keep, 3 = can summarize away) */
  priority: 1 | 2 | 3;
}

export interface SessionState {
  id: string;
  command: string;
  requirement: string;
  startedAt: string;
  entries: MemoryEntry[];
  /** Summarized older entries (compressed to save tokens) */
  summary: string;
  /** Number of entries that have been summarized into `summary` */
  summarizedCount: number;
}

const STATE_KEY = 'autospec.sessionMemory';
const MAX_ENTRIES_BEFORE_SUMMARIZE = 30;

// ─── SessionMemory ────────────────────────────────────────────────────────────

export class SessionMemory {
  private state: SessionState | null = null;
  private extensionContext: vscode.ExtensionContext;

  constructor(extensionContext: vscode.ExtensionContext) {
    this.extensionContext = extensionContext;
    this.load();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  /** Start a new session (clears previous state) */
  startSession(command: string, requirement: string): void {
    this.state = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      command,
      requirement,
      startedAt: new Date().toISOString(),
      entries: [],
      summary: '',
      summarizedCount: 0,
    };
    this.addEntry('requirement', requirement, 1);
    this.save();
    log(`🧠 SessionMemory: started new session for /${command}`);
  }

  /** Check if there's an active session */
  hasActiveSession(): boolean {
    return this.state !== null;
  }

  /** Get current session info */
  getSession(): SessionState | null {
    return this.state;
  }

  /** End the current session */
  endSession(): void {
    this.state = null;
    this.save();
    log('🧠 SessionMemory: session ended');
  }

  // ── Add entries ────────────────────────────────────────────────────

  addDecision(content: string): void {
    this.addEntry('decision', content, 1);
  }

  addPlan(content: string): void {
    this.addEntry('plan', content, 1);
  }

  addFeedback(content: string): void {
    this.addEntry('feedback', content, 2);
  }

  addError(content: string): void {
    this.addEntry('error', content, 2);
  }

  addMilestone(content: string): void {
    this.addEntry('milestone', content, 2);
  }

  addPreference(content: string): void {
    this.addEntry('preference', content, 1);
  }

  // ── Context generation ─────────────────────────────────────────────

  /**
   * Generate a context string for injection into prompts.
   * Stays within maxTokens budget. Prioritizes:
   *  1. Current requirement
   *  2. Priority-1 entries (decisions, plan, preferences)
   *  3. Summary of older entries
   *  4. Priority-2 entries (feedback, errors, milestones)
   *  5. Priority-3 entries (trimmed first)
   */
  getContextForPrompt(maxTokens: number = 3000): string {
    if (!this.state) { return ''; }

    const parts: string[] = [];

    // Always include requirement
    parts.push(`## Active Task\n**Command:** /${this.state.command}\n**Requirement:** ${this.state.requirement}`);

    // Include summary if exists
    if (this.state.summary) {
      parts.push(`## Earlier Context (summarized)\n${this.state.summary}`);
    }

    // Group entries by priority
    const p1 = this.state.entries.filter(e => e.priority === 1 && e.type !== 'requirement');
    const p2 = this.state.entries.filter(e => e.priority === 2);
    const p3 = this.state.entries.filter(e => e.priority === 3);

    if (p1.length > 0) {
      parts.push('## Key Decisions & Plan\n' + p1.map(e => `- [${e.type}] ${e.content}`).join('\n'));
    }

    if (p2.length > 0) {
      parts.push('## Progress\n' + p2.map(e => `- [${e.type}] ${e.content}`).join('\n'));
    }

    // Build context and trim if over budget
    let context = parts.join('\n\n');
    let tokens = estimateTokens(context);

    // Trim priority-3 entries first, then p2 from oldest
    if (tokens > maxTokens && p3.length > 0) {
      parts.pop(); // remove p3 section
      context = parts.join('\n\n');
      tokens = estimateTokens(context);
    }

    if (tokens > maxTokens && p2.length > 0) {
      // Keep only last 5 progress entries
      const trimmedP2 = p2.slice(-5);
      parts[parts.length - 1] = '## Progress (recent)\n' + trimmedP2.map(e => `- [${e.type}] ${e.content}`).join('\n');
      context = parts.join('\n\n');
    }

    return `\n=== SESSION MEMORY ===\n${context}\n=== END SESSION MEMORY ===\n`;
  }

  // ── Internal ───────────────────────────────────────────────────────

  private addEntry(type: MemoryEntry['type'], content: string, priority: MemoryEntry['priority']): void {
    if (!this.state) { return; }

    this.state.entries.push({
      timestamp: new Date().toISOString(),
      type,
      content: content.slice(0, 500), // cap individual entries
      priority,
    });

    // Auto-summarize if too many entries
    if (this.state.entries.length > MAX_ENTRIES_BEFORE_SUMMARIZE) {
      this.compactEntries();
    }

    this.save();
  }

  /**
   * Compact older low-priority entries into the summary string.
   * Keeps all priority-1 entries, summarizes priority-2/3.
   */
  private compactEntries(): void {
    if (!this.state) { return; }

    const cutoff = Math.floor(this.state.entries.length / 2);
    const old = this.state.entries.slice(0, cutoff);
    const keep = this.state.entries.slice(cutoff);

    // Build summary from old entries
    const oldP1 = old.filter(e => e.priority === 1);
    const oldOther = old.filter(e => e.priority !== 1);

    const summaryParts: string[] = [];
    if (this.state.summary) { summaryParts.push(this.state.summary); }
    if (oldP1.length > 0) {
      summaryParts.push(oldP1.map(e => `- [${e.type}] ${e.content}`).join('\n'));
    }
    if (oldOther.length > 0) {
      summaryParts.push(`(${oldOther.length} progress entries compacted)`);
    }

    this.state.summary = summaryParts.join('\n');
    this.state.entries = [...oldP1, ...keep]; // preserve p1 entries
    this.state.summarizedCount += oldOther.length;

    log(`🧠 SessionMemory: compacted ${old.length} entries → summary (${this.state.entries.length} remaining)`);
  }

  private save(): void {
    this.extensionContext.workspaceState.update(STATE_KEY, this.state);
  }

  private load(): void {
    this.state = this.extensionContext.workspaceState.get<SessionState>(STATE_KEY) ?? null;
  }
}
