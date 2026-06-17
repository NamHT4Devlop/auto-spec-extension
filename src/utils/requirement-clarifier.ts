/**
 * requirement-clarifier.ts — AI-Driven Requirement Enrichment
 *
 * Before running the 13-step pipeline, this module evaluates whether
 * a requirement is clear enough. If vague, it asks targeted questions
 * via VS Code Quick Pick or chat stream, then produces an enriched requirement.
 *
 * Scoring dimensions:
 *   - Specificity: Does it name entities, endpoints, fields?
 *   - Scope: Is the boundary clear (what's included vs excluded)?
 *   - Acceptance: Are there testable success criteria?
 *   - Technical: Are tech choices specified where needed?
 *
 * Usage:
 *   const clarifier = new RequirementClarifier();
 *   const enriched = await clarifier.clarifyIfNeeded(requirement, root, model, token, stream);
 */

import * as vscode from 'vscode';
import { log } from '../logger';
import { callCopilot } from './copilot';
import { loadKnowledgeBase } from './file-utils';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClarityAssessment {
  score: number;           // 0-100
  isReady: boolean;        // score >= threshold
  missingAspects: string[];
  suggestedQuestions: string[];
  enrichedRequirement?: string;
}

/** Outcome of a clarification pass. */
export interface ClarifyResult {
  /** false = caller should NOT run the (expensive) pipeline — user was asked to refine. */
  proceed: boolean;
  /** Requirement to use if proceeding (possibly enriched). */
  requirement: string;
}

const DEFAULT_CLARITY_THRESHOLD = 60;
/** Requirements with at least this many words skip the (cheap) assessment call. */
const SKIP_ASSESSMENT_WORDS = 30;

// ─── RequirementClarifier ─────────────────────────────────────────────────────

export class RequirementClarifier {

  /**
   * Main entry point. Decides whether the requirement is clear enough to build.
   *
   * - Clear enough → { proceed: true, requirement } (possibly enriched).
   * - Vague + chat stream → asks targeted questions and HALTS
   *   ({ proceed: false }) so we don't burn a full pipeline on a vague spec.
   * - Vague + no stream (Command Palette) → asks via input boxes and enriches,
   *   then proceeds (never blocks the user outright).
   */
  async clarifyIfNeeded(
    requirement: string,
    workspaceRoot: string,
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken,
    stream?: vscode.ChatResponseStream,
  ): Promise<ClarifyResult> {
    const cfg = vscode.workspace.getConfiguration('autoSpecKit');
    if (!cfg.get<boolean>('clarify.enabled', true)) {
      return { proceed: true, requirement };
    }
    const threshold = cfg.get<number>('clarify.threshold', DEFAULT_CLARITY_THRESHOLD);

    // Long, detailed requirements skip the assessment call to save tokens.
    if (requirement.split(/\s+/).filter(Boolean).length >= SKIP_ASSESSMENT_WORDS) {
      log('📝 RequirementClarifier: requirement looks detailed enough, skipping');
      return { proceed: true, requirement };
    }

    const assessment = await this.assess(requirement, workspaceRoot, model, token, threshold);

    if (assessment.isReady) {
      log(`📝 RequirementClarifier: score=${assessment.score}/100 — clear enough`);
      return { proceed: true, requirement: assessment.enrichedRequirement ?? requirement };
    }

    log(`📝 RequirementClarifier: score=${assessment.score}/100 (threshold ${threshold}) — needs clarification`);

    // ── Chat mode: show questions and HALT (do not run the pipeline) ──
    if (stream) {
      stream.markdown(
        `\n\n⚠️ **Your requirement is a bit vague** (clarity ${assessment.score}/100). ` +
        `To avoid building the wrong thing, please answer these and re-run \`/build\`:\n\n`
      );
      const qs = assessment.suggestedQuestions.length
        ? assessment.suggestedQuestions
        : ['What exactly should change (entities, endpoints, UI)?',
           'What is in scope and out of scope?',
           'What does "done" look like (acceptance criteria)?'];
      qs.forEach((q, i) => stream.markdown(`${i + 1}. ${q}\n`));
      if (assessment.missingAspects.length) {
        stream.markdown(`\n_Missing: ${assessment.missingAspects.join(', ')}._\n`);
      }
      stream.markdown(
        `\n💡 Re-run with detail, e.g.: \`@autospec /build ${requirement} — <add specifics from above>\`\n`
      );
      return { proceed: false, requirement };
    }

    // ── Command Palette mode: ask via input boxes, then enrich ──
    const answers = await this.askClarifyingQuestions(assessment.suggestedQuestions);
    if (!answers.length) {
      log('📝 RequirementClarifier: user skipped clarification — proceeding with original');
      return { proceed: true, requirement };
    }
    const enriched = await this.enrichRequirement(requirement, answers, model, token);
    log(`📝 RequirementClarifier: enriched from ${requirement.length} → ${enriched.length} chars`);
    return { proceed: true, requirement: enriched };
  }

  /**
   * Assess requirement clarity using AI.
   */
  private async assess(
    requirement: string,
    workspaceRoot: string,
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken,
    threshold: number = DEFAULT_CLARITY_THRESHOLD,
  ): Promise<ClarityAssessment> {
    const cfg = vscode.workspace.getConfiguration('autoSpecKit');
    const kbRelPath = cfg.get<string>('knowledgeBasePath', 'knowledge-base');

    // Load KB summary (just file names + first lines) for context
    let kbContext = '';
    try {
      const fs = require('fs');
      const path = require('path');
      const kbDir = path.join(workspaceRoot, kbRelPath);
      if (fs.existsSync(kbDir)) {
        const files = fs.readdirSync(kbDir).filter((f: string) => f.endsWith('.md'));
        kbContext = files.map((f: string) => {
          const content = fs.readFileSync(path.join(kbDir, f), 'utf-8');
          const firstLine = content.split('\n').find((l: string) => l.trim().length > 0) ?? '';
          return `- ${f}: ${firstLine.slice(0, 100)}`;
        }).join('\n');
      }
    } catch { /* no KB available */ }

    const prompt = `Assess the clarity of this software development requirement for an AI coding agent.

## REQUIREMENT
${requirement}

${kbContext ? `## PROJECT KNOWLEDGE BASE (file summaries)\n${kbContext}` : ''}

## SCORING DIMENSIONS
1. **Specificity** (0-25): Does it name concrete entities, endpoints, fields, UI elements?
2. **Scope** (0-25): Is the boundary clear — what's included vs excluded?
3. **Acceptance** (0-25): Are there testable success criteria or expected behaviors?
4. **Technical** (0-25): Are necessary tech choices clear (or inferable from KB)?

## OUTPUT FORMAT (JSON only)
{
  "specificity": <0-25>,
  "scope": <0-25>,
  "acceptance": <0-25>,
  "technical": <0-25>,
  "totalScore": <0-100>,
  "missingAspects": ["<what's unclear>", ...],
  "suggestedQuestions": ["<question to ask user>", ...max 3]
}`;

    try {
      const response = await callCopilot(model, 'You are a requirements analyst. Return ONLY valid JSON.', prompt, token, 'Clarity Assessment');
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const score = parsed.totalScore ?? 0;
        return {
          score,
          isReady: score >= threshold,
          missingAspects: parsed.missingAspects ?? [],
          suggestedQuestions: (parsed.suggestedQuestions ?? []).slice(0, 3),
        };
      }
    } catch (err) {
      log(`⚠️ RequirementClarifier: assessment failed — ${err}`);
    }

    // Fallback: treat as ready (don't block user)
    return { score: 100, isReady: true, missingAspects: [], suggestedQuestions: [] };
  }

  /**
   * Ask clarifying questions via VS Code input boxes (Command Palette mode).
   * Returns the collected Q&A pairs (empty if the user skipped everything).
   */
  private async askClarifyingQuestions(questions: string[]): Promise<string[]> {
    const qs = questions.length ? questions : [
      'What exactly should change (entities, endpoints, UI)?',
      'What is in scope and what is out of scope?',
      'What does "done" look like (acceptance criteria)?',
    ];

    const answers: string[] = [];
    for (const question of qs) {
      const answer = await vscode.window.showInputBox({
        title: '📝 Clarify Requirement',
        prompt: question,
        placeHolder: 'Type your answer or press Escape to skip',
        ignoreFocusOut: true,
      });
      if (answer && answer.trim()) { answers.push(`Q: ${question}\nA: ${answer.trim()}`); }
    }

    return answers;
  }

  /**
   * Merge original requirement + user answers into an enriched version.
   */
  private async enrichRequirement(
    original: string,
    answers: string[],
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken,
  ): Promise<string> {
    const prompt = `Merge this requirement with the user's clarifying answers into a single, detailed requirement. Keep it as a clear paragraph — no headers, no markdown. Be concise but complete.

## ORIGINAL REQUIREMENT
${original}

## CLARIFICATIONS
${answers.join('\n\n')}

## OUTPUT
Write the enriched requirement as a single detailed paragraph:`;

    try {
      const enriched = await callCopilot(
        model,
        'You are a technical writer. Merge requirements concisely.',
        prompt,
        token,
        'Enrich Requirement',
      );
      return enriched.trim() || original;
    } catch {
      return original;
    }
  }
}
