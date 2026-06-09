/**
 * model-selector.ts
 * Handles GitHub Copilot model discovery, selection, and preference persistence.
 *
 * Priority order:
 *   1. autoSpecKit.askModelOnStart = true  → always show QuickPick
 *   2. autoSpecKit.model is set            → find that model by ID / family
 *   3. fallback                            → pick best available (prefers larger models)
 */

import * as vscode from 'vscode';
import { log } from '../logger';

// Known Copilot model families ranked by capability (higher = better for code tasks)
// Updated 2026-05 — reflects GitHub Copilot supported model list
// Closing-down models (GPT-4.1, GPT-5.2, GPT-5.2-Codex) kept at low priority so they're
// still usable if explicitly requested but never auto-selected over a GA model.
const MODEL_PRIORITY: Record<string, number> = {
  // ── OpenAI GPT-5 family ──────────────────────────────────────────
  'gpt-5.5':               100,   // GPT-5.5  — GA, flagship
  'gpt-5.4':                96,   // GPT-5.4  — GA
  'gpt-5.3-codex':          93,   // GPT-5.3-Codex — GA, code-specialized
  'goldeneye':              88,   // Goldeneye — fine-tuned GPT-5.1-Codex (preview)
  'gpt-5.4-mini':           84,   // GPT-5.4 mini — GA
  'gpt-5-mini':             72,   // GPT-5 mini — GA
  'raptor-mini':            68,   // Raptor mini — fine-tuned GPT-5 mini (preview)
  'gpt-5.4-nano':           60,   // GPT-5.4 nano — GA, lightweight

  // ── Anthropic Claude family ──────────────────────────────────────
  'claude-opus-4-7':        97,   // Claude Opus 4.7 — GA, latest Opus
  'claude-opus-4-6':        94,   // Claude Opus 4.6 — GA
  'claude-opus-4-5':        89,   // Claude Opus 4.5 — GA
  'claude-sonnet-4-6':      85,   // Claude Sonnet 4.6 — GA
  'claude-sonnet-4-5':      82,   // Claude Sonnet 4.5 — GA
  'claude-haiku-4-5':       58,   // Claude Haiku 4.5 — GA, fast/cheap

  // ── Google Gemini family ─────────────────────────────────────────
  'gemini-3.1-pro':         87,   // Gemini 3.1 Pro — preview
  'gemini-3.5-flash':       75,   // Gemini 3.5 Flash — GA
  'gemini-3-flash':         70,   // Gemini 3 Flash — preview
  'gemini-2.5-pro':         83,   // Gemini 2.5 Pro — GA

  // ── Closing-down / legacy (kept low so fallback avoids them) ─────
  'gpt-4.1':                35,   // Closing 2026-06-01
  'gpt-5.2-codex':          33,   // Closing 2026-06-01
  'gpt-5.2':                32,   // Closing 2026-06-01

  // ── Old models (pre-2026 compatibility) ──────────────────────────
  'gpt-4o':                 40,
  'o3':                     45,
  'o1':                     38,
  'o3-mini':                36,
  'o1-mini':                34,
  'gpt-4-turbo':            30,
  'gpt-4':                  28,
  'gpt-4o-mini':            25,
  'gpt-3.5-turbo':          10,
};

function modelScore(m: vscode.LanguageModelChat): number {
  // Check exact id match first, then family
  const id  = (m.id     ?? '').toLowerCase();
  const fam = (m.family ?? '').toLowerCase();
  for (const [key, score] of Object.entries(MODEL_PRIORITY)) {
    if (id.includes(key) || fam.includes(key)) { return score; }
  }
  return 40; // unknown — middle priority
}

/**
 * Fetch all Copilot models and return sorted by quality (best first).
 */
async function listModels(): Promise<vscode.LanguageModelChat[]> {
  const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  return models.sort((a, b) => modelScore(b) - modelScore(a));
}

/**
 * Show a QuickPick with all available Copilot models.
 * Returns the chosen model (or undefined if cancelled).
 * Optionally saves the choice to settings.
 */
export async function pickModel(
  models: vscode.LanguageModelChat[],
  currentModelId: string
): Promise<vscode.LanguageModelChat | undefined> {

  const items = models.map(m => {
    const score  = modelScore(m);
    const tag    = score >= 90 ? '⭐ ' : score >= 70 ? '✦ ' : score >= 50 ? '  ' : '⚠ ';
    const active = m.id === currentModelId ? ' ← current' : '';
    return {
      label:       `${tag}${m.name}`,
      description: `${m.id}${active}`,
      detail:      `Family: ${m.family ?? 'unknown'}  |  Max tokens: ${m.maxInputTokens?.toLocaleString() ?? 'N/A'}`,
      model:       m,
    };
  });

  const picked = await vscode.window.showQuickPick(items, {
    title:       '🤖 Auto Spec Kit — Select Copilot Model',
    placeHolder: 'Select model (⭐ = top-tier ≥90pts | ✦ = good ≥70pts | ⚠ = closing/legacy)',
    matchOnDescription: true,
    matchOnDetail:      true,
  });

  return picked?.model;
}

/**
 * Main entry point: resolve the model to use for a command invocation.
 *
 * Logic:
 *   - If askModelOnStart=true → always show picker
 *   - Else if autoSpecKit.model is set → find that model (warn if not found, fallback)
 *   - Else → use best available (no UI interruption)
 */
export async function resolveModel(): Promise<vscode.LanguageModelChat | undefined> {
  const cfg            = vscode.workspace.getConfiguration('autoSpecKit');
  const preferredId    = cfg.get<string>('model', '').trim();
  const askOnStart     = cfg.get<boolean>('askModelOnStart', false);

  // 1. Get all available models
  let models: vscode.LanguageModelChat[];
  try {
    models = await listModels();
  } catch (err) {
    vscode.window.showErrorMessage(`Auto Spec Kit: Cannot connect to GitHub Copilot — ${err}`);
    return undefined;
  }

  if (!models.length) {
    vscode.window.showErrorMessage(
      'Auto Spec Kit: No GitHub Copilot models found. ' +
      'Sign in: Ctrl+Shift+P → "GitHub Copilot: Sign In"'
    );
    return undefined;
  }

  // 2. Always show picker if setting is on
  if (askOnStart) {
    const chosen = await pickModel(models, preferredId);
    if (!chosen) { return undefined; }  // user cancelled
    log(`✅ Model (picked): ${chosen.name}  [${chosen.id}]`);
    return chosen;
  }

  // 3. Try to find preferred model by ID or family substring
  if (preferredId) {
    const found = models.find(m =>
      m.id?.toLowerCase().includes(preferredId.toLowerCase()) ||
      m.family?.toLowerCase().includes(preferredId.toLowerCase()) ||
      m.name?.toLowerCase().includes(preferredId.toLowerCase())
    );
    if (found) {
      log(`✅ Model (preferred): ${found.name}  [${found.id}]`);
      return found;
    }
    // Preferred not found — warn and fallback
    log(`⚠  Model "${preferredId}" not found. Falling back to ${models[0].name}`);
    vscode.window.showWarningMessage(
      `Auto Spec Kit: Model "${preferredId}" is not available. ` +
      `Using fallback: ${models[0].name}`,
      'Change model'
    ).then(action => {
      if (action === 'Change model') {
        vscode.commands.executeCommand('autoSpecKit.selectModel');
      }
    });
  }

  // 4. Fallback — best available (already sorted by score)
  const best = models[0];
  log(`✅ Model (auto): ${best.name}  [${best.id}]`);
  return best;
}

/**
 * Command: autoSpecKit.selectModel
 * Shows model picker and saves choice to settings.
 */
export async function runSelectModel(): Promise<void> {
  let models: vscode.LanguageModelChat[];
  try {
    models = await listModels();
  } catch (err) {
    vscode.window.showErrorMessage(`Auto Spec Kit: Copilot connection error — ${err}`);
    return;
  }

  if (!models.length) {
    vscode.window.showErrorMessage('Auto Spec Kit: No models available. Check GitHub Copilot.');
    return;
  }

  const cfg         = vscode.workspace.getConfiguration('autoSpecKit');
  const currentId   = cfg.get<string>('model', '');
  const chosen      = await pickModel(models, currentId);

  if (!chosen) { return; }  // cancelled

  // Save to user settings
  await cfg.update('model', chosen.id, vscode.ConfigurationTarget.Global);
  log(`✅ Model saved to settings: ${chosen.name}  [${chosen.id}]`);

  vscode.window.showInformationMessage(
    `🤖 Auto Spec Kit will use: ${chosen.name}`,
    'Clear preference (use auto)'
  ).then(action => {
    if (action === 'Clear preference (use auto)') {
      cfg.update('model', '', vscode.ConfigurationTarget.Global);
      log('ℹ  Model preference cleared — using auto selection');
    }
  });
}
