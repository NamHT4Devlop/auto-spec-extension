/**
 * learning-store.ts — Adaptive Learning from Past Sessions
 *
 * Makes the agent smarter over time by persisting:
 *   - Code review patterns (common fixes → prevent next time)
 *   - Test failure patterns (recurring issues → adjust prompts)
 *   - User preferences (naming, architecture, rejected approaches)
 *   - Project conventions (inferred from feedback)
 *
 * Stored in .autospec/learnings.json.
 * Injected into prompts as "project knowledge" for future tasks.
 */

import * as fs from 'fs';
import * as path from 'path';
import { log } from '../logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Learning {
  id: string;
  timestamp: string;
  category: 'review-fix' | 'test-pattern' | 'user-preference' | 'convention' | 'architecture' | 'avoid';
  /** Short summary */
  title: string;
  /** Detailed content */
  detail: string;
  /** How many times this learning has been reinforced */
  reinforcements: number;
  /** Source: which session/step produced this learning */
  source: string;
}

export interface LearningStoreData {
  version: number;
  updatedAt: string;
  learnings: Learning[];
}

const MAX_LEARNINGS = 100;
const STORE_VERSION = 1;

// ─── LearningStore ────────────────────────────────────────────────────────────

export class LearningStore {
  private root: string;
  private data: LearningStoreData;
  private filePath: string;

  constructor(workspaceRoot: string) {
    this.root = workspaceRoot;
    this.filePath = path.join(workspaceRoot, '.autospec', 'learnings.json');
    this.data = this.load();
  }

  // ── Add learnings ──────────────────────────────────────────────────

  /**
   * Add a learning from a code review (e.g., "Always use parameterized queries for SQL").
   */
  addReviewFix(title: string, detail: string, source: string): void {
    this.add('review-fix', title, detail, source);
  }

  /**
   * Add a test pattern (e.g., "Service tests need database mock setup").
   */
  addTestPattern(title: string, detail: string, source: string): void {
    this.add('test-pattern', title, detail, source);
  }

  /**
   * Add a user preference (e.g., "User prefers service classes over utility functions").
   */
  addUserPreference(title: string, detail: string, source: string): void {
    this.add('user-preference', title, detail, source);
  }

  /**
   * Add a convention (e.g., "All API responses use { data, error, meta } wrapper").
   */
  addConvention(title: string, detail: string, source: string): void {
    this.add('convention', title, detail, source);
  }

  /**
   * Add an architecture decision (e.g., "Event-driven for inter-service communication").
   */
  addArchitecture(title: string, detail: string, source: string): void {
    this.add('architecture', title, detail, source);
  }

  /**
   * Add something to avoid (e.g., "Don't use library X — user rejected it in task Y").
   */
  addAvoid(title: string, detail: string, source: string): void {
    this.add('avoid', title, detail, source);
  }

  // ── Query ──────────────────────────────────────────────────────────

  /** Get all learnings */
  getAll(): Learning[] {
    return this.data.learnings;
  }

  /** Get learnings by category */
  getByCategory(category: Learning['category']): Learning[] {
    return this.data.learnings.filter(l => l.category === category);
  }

  /** Get top N learnings by reinforcement count */
  getTopLearnings(n: number = 20): Learning[] {
    return [...this.data.learnings]
      .sort((a, b) => b.reinforcements - a.reinforcements)
      .slice(0, n);
  }

  /**
   * Generate a context string for prompt injection.
   * Returns the most important learnings formatted for the AI.
   * Stays under ~maxTokens estimated tokens.
   */
  toPromptContext(maxEntries: number = 15): string {
    const learnings = this.getTopLearnings(maxEntries);
    if (learnings.length === 0) { return ''; }

    const sections: Record<string, string[]> = {};
    for (const l of learnings) {
      const key = this.categoryLabel(l.category);
      if (!sections[key]) { sections[key] = []; }
      sections[key].push(`- ${l.title}${l.reinforcements > 1 ? ` (×${l.reinforcements})` : ''}`);
    }

    let result = '\n=== PROJECT LEARNINGS (from past sessions) ===\n';
    for (const [section, items] of Object.entries(sections)) {
      result += `\n### ${section}\n${items.join('\n')}\n`;
    }
    result += '\n=== END LEARNINGS ===\n';
    return result;
  }

  // ── Internal ───────────────────────────────────────────────────────

  private add(category: Learning['category'], title: string, detail: string, source: string): void {
    // Check for duplicate — reinforce instead of adding
    const existing = this.data.learnings.find(
      l => l.category === category && l.title.toLowerCase() === title.toLowerCase(),
    );

    if (existing) {
      existing.reinforcements++;
      existing.timestamp = new Date().toISOString();
      if (detail.length > existing.detail.length) { existing.detail = detail; }
      log(`🧠 LearningStore: reinforced "${title}" (×${existing.reinforcements})`);
    } else {
      this.data.learnings.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toISOString(),
        category,
        title: title.slice(0, 200),
        detail: detail.slice(0, 1000),
        reinforcements: 1,
        source,
      });
      log(`🧠 LearningStore: added "${title}" [${category}]`);
    }

    // Prune if over limit — remove least reinforced
    if (this.data.learnings.length > MAX_LEARNINGS) {
      this.data.learnings.sort((a, b) => b.reinforcements - a.reinforcements);
      this.data.learnings = this.data.learnings.slice(0, MAX_LEARNINGS);
    }

    this.data.updatedAt = new Date().toISOString();
    this.save();
  }

  private categoryLabel(cat: Learning['category']): string {
    const labels: Record<string, string> = {
      'review-fix': 'Code Review Patterns',
      'test-pattern': 'Test Patterns',
      'user-preference': 'User Preferences',
      'convention': 'Project Conventions',
      'architecture': 'Architecture Decisions',
      'avoid': 'Things to Avoid',
    };
    return labels[cat] ?? cat;
  }

  private load(): LearningStoreData {
    if (fs.existsSync(this.filePath)) {
      try {
        return JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      } catch {
        log('⚠️ LearningStore: corrupted file, starting fresh');
      }
    }
    return { version: STORE_VERSION, updatedAt: new Date().toISOString(), learnings: [] };
  }

  private save(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }
}
