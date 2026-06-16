import * as vscode from 'vscode';

let _channel: vscode.OutputChannel | undefined;

export function initChannel(name: string): vscode.OutputChannel {
  _channel = vscode.window.createOutputChannel(name);
  return _channel;
}

export function getChannel(): vscode.OutputChannel {
  if (!_channel) {
    throw new Error('Logger channel not initialized. Call initChannel() first.');
  }
  return _channel;
}

export function log(msg: string): void {
  // No-op if the channel isn't initialized (e.g. unit tests, early calls)
  if (!_channel) { return; }
  _channel.appendLine(msg);
}

export function logRaw(text: string): void {
  if (!_channel) { return; }
  _channel.append(text);
}

export function stepHeader(n: number, total: number, title: string): void {
  const ch = getChannel();
  ch.appendLine('');
  ch.appendLine('═'.repeat(66));
  ch.appendLine(`  ▶  STEP ${String(n).padStart(2, '0')} / ${total} — ${title}`);
  ch.appendLine('═'.repeat(66));
  ch.appendLine('');
}

export function kbHeader(n: number, total: number, title: string): void {
  const ch = getChannel();
  ch.appendLine('');
  ch.appendLine('═'.repeat(66));
  ch.appendLine(`  📚  KB ${String(n).padStart(2, '0')} / ${total} — ${title}`);
  ch.appendLine('═'.repeat(66));
  ch.appendLine('');
}

export function banner(lines: string[]): void {
  const ch = getChannel();
  ch.appendLine('');
  ch.appendLine('╔' + '═'.repeat(64) + '╗');
  for (const line of lines) {
    const padded = line.padEnd(64);
    ch.appendLine(`║  ${padded.slice(0, 62)}  ║`);
  }
  ch.appendLine('╚' + '═'.repeat(64) + '╝');
  ch.appendLine('');
}
