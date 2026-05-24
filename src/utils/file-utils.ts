import * as fs from 'fs';
import * as path from 'path';
import { log } from '../logger';
import { ExtractedFile } from '../types';

export function loadKnowledgeBase(root: string, kbRelPath: string): string {
  const kbPath = path.join(root, kbRelPath);
  if (!fs.existsSync(kbPath)) {
    log(`⚠  Knowledge base not found: ${kbPath}`);
    log('   → Continuing without KB — output will be more generic.');
    return '';
  }

  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(md|txt)$/i.test(entry.name)) {
        try {
          const content = fs.readFileSync(full, 'utf-8').trim();
          if (content) {
            const rel = path.relative(kbPath, full);
            parts.push(`### [${rel}]\n${content}`);
          }
        } catch { /* skip unreadable files */ }
      }
    }
  };
  walk(kbPath);
  log(`✅ Knowledge base: ${parts.length} files loaded`);
  return parts.join('\n\n---\n\n');
}

export function extractFiles(content: string): ExtractedFile[] {
  const files: ExtractedFile[] = [];
  // Match: ### FILE: <path>\n```<lang?>\n<code>\n```
  const re = /###\s*FILE:\s*([^\n]+)\n```[^\n]*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    files.push({ filePath: m[1].trim(), code: m[2].trim() });
  }
  return files;
}

export function saveFile(sessionDir: string, rel: string, content: string): string {
  const full = path.join(sessionDir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
  return full;
}
