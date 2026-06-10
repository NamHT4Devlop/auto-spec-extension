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

const CLARITY_THRESHOLD = 60;

// ─── RequirementClarifier ─────────────────────────────────────────────────────

export class RequirementClarifier {

  /**
   * Main entry point. Returns the original requirement if clear enough,
   * or an enriched version after clarification.
   */
  async clarifyIfNeeded(
    requirement: string,
    workspaceRoot: string,
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken,
    stream?: vscode.ChatResponseStream,
  ): Promise<string> {
    // Very short requirements are almost always vague
    if (requirement.split(/\s+/).length >= 15) {
      log('📝 RequirementClarifier: requirement looks detailed enough, skipping');
      return requirement;
    }

    const assessment = await this.assess(requirement, workspaceRoot, model, token);

    if (assessment.isReady) {
      log(`📝 RequirementClarifier: score=${assessment.score}/100 — clear enough`);
      return assessment.enrichedRequirement ?? requirement;
    }

    log(`📝 RequirementClarifier: score=${assessment.score}/100 — needs clarification`);

    // Ask user for clarification
    const answers = await this.askClarifyingQuestions(
      requirement,
      assessment.suggestedQuestions,
      stream,
    );

    if (!answers || answers.length === 0) {
      // User skipped — proceed with original
      log('📝 RequirementClarifier: user skipped clarification');
      return requirement;
    }

    // Merge answers into enriched requirement
    const enriched = await this.enrichRequirement(requirement, answers, model, token);
    log(`📝 RequirementClarifier: enriched from ${requirement.length} → ${enriched.length} chars`);
    return enriched;
  }

  /**
   * Assess requirement clarity using AI.
   */
  private async assess(
    requirement: string,
    workspaceRoot: string,
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken,
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
          isReady: score >= CLARITY_THRESHOLD,
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
   * Ask clarifying questions via VS Code Quick Pick or chat stream.
   */
  private async askClarifyingQuestions(
    requirement: string,
    questions: string[],
    stream?: vscode.ChatResponseStream,
  ): Promise<string[]> {
    if (questions.length === 0) { return []; }

    // If we have a chat stream, ask via chat (non-blocking UX)
    if (stream) {
      stream.markdown(`\n\n💡 **Your requirement could be more specific.** I have a few quick questions:\n\n`);
      questions.forEach((q, i) => {
        stream.markdown(`${i + 1}. ${q}\n`);
      });
      stream.markdown(`\n*Tip: Re-run \`/build\` with more detail, or add answers after your requirement.*\n`);
      // Return empty — user will re-submit with more detail
      return [];
    }

    // Fallback: use Quick Pick dialog
    const answers: string[] = [];
    for (const question of questions) {
      const answer = await vscode.window.showInputBox({
        title: '📝 Clarify Requirement',
        prompt: question,
        placeHolder: 'Type your answer or press Escape to skip',
      });
      if (answer) { answers.push(`Q: ${question}\nA: ${answer}`); }
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
