/**
 * session-store.ts
 * Manages session directories and provides helpers for finding
 * resumable sessions.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface SessionInfo {
  dir: string;
  requirement: string;
  completedSteps: number;
  totalSteps: number;
  timestamp: string;
  hasState: boolean;
}

/**
 * List all sessions in the sessions directory, sorted by date (newest first).
 * Optionally filter to only sessions with saved pipeline state (resumable).
 */
export function listSessions(
  workspaceRoot: string,
  sessionsDir: string = 'spec-kit-sessions',
  resumableOnly: boolean = false,
): SessionInfo[] {
  const sessionsPath = path.join(workspaceRoot, sessionsDir);
  if (!fs.existsSync(sessionsPath)) { return []; }

  const entries = fs.readdirSync(sessionsPath, { withFileTypes: true })
    .filter(e => e.isDirectory());

  const sessions: SessionInfo[] = [];

  for (const entry of entries) {
    const dir = path.join(sessionsPath, entry.name);
    const statePath = path.join(dir, '.pipeline-state.json');
    const hasState = fs.existsSync(statePath);

    if (resumableOnly && !hasState) { continue; }

    let requirement = '';
    let completedSteps = 0;
    let timestamp = '';

    if (hasState) {
      try {
        const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
        requirement = state.requirement ?? '';
        completedSteps = state.completedSteps?.length ?? 0;
        timestamp = state.timestamp ?? '';
      } catch { /* skip */ }
    } else {
      // Try to get info from README.md
      const readmePath = path.join(dir, 'README.md');
      if (fs.existsSync(readmePath)) {
        try {
          const readme = fs.readFileSync(readmePath, 'utf-8');
          const reqMatch = readme.match(/\*\*Requirement\*\*\s*\|\s*(.*)/);
          if (reqMatch) { requirement = reqMatch[1].trim(); }
        } catch { /* skip */ }
      }
      completedSteps = 13; // Assume complete if no state file
    }

    sessions.push({
      dir,
      requirement: requirement || entry.name,
      completedSteps,
      totalSteps: 13,
      timestamp: timestamp || entry.name.slice(0, 19),
      hasState,
    });
  }

  // Sort newest first
  sessions.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return sessions;
}

/**
 * Create a new session directory with standard subdirectories.
 */
export function createSessionDir(
  workspaceRoot: string,
  sessionsDir: string,
  requirement: string,
): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const slug = requirement.slice(0, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');
  const sessionDir = path.join(workspaceRoot, sessionsDir, `${ts}-${slug}`);

  const subdirs = [
    '01-plan', '02-plan-review', '03-code', '04-code-review',
    '05-tests', '06-test-review', '07-evidence', '08-files',
    '09-kb-updates',
  ];

  for (const sub of subdirs) {
    fs.mkdirSync(path.join(sessionDir, sub), { recursive: true });
  }

  return sessionDir;
}
