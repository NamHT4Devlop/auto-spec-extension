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

/**
 * Resolve `rel` against `root` and guarantee the result stays inside `root`.
 * Rejects absolute paths and any `..` traversal that would escape the root.
 * Throws on violation — callers must treat this as a hard security boundary.
 */
export function safeResolve(root: string, rel: string): string {
  const cleaned = rel.replace(/\\/g, '/').trim();
  if (!cleaned || cleaned.includes('\0')) {
    throw new Error(`Invalid file path: ${JSON.stringify(rel)}`);
  }
  if (path.isAbsolute(cleaned)) {
    throw new Error(`Refusing absolute file path: ${cleaned}`);
  }
  const rootResolved = path.resolve(root);
  const dest = path.resolve(rootResolved, cleaned);
  // Ensure dest is rootResolved itself or strictly underneath it.
  if (dest !== rootResolved && !dest.startsWith(rootResolved + path.sep)) {
    throw new Error(`Refusing to write outside workspace: ${cleaned}`);
  }
  return dest;
}

/** True if `rel` is a safe, in-tree relative path (no throw). */
export function isSafeRelativePath(root: string, rel: string): boolean {
  try {
    safeResolve(root, rel);
    return true;
  } catch {
    return false;
  }
}

export function extractFiles(content: string): ExtractedFile[] {
  const files: ExtractedFile[] = [];
  // Match: ### FILE: <path>\n```<lang?>\n<code>\n```
  const re = /###\s*FILE:\s*([^\n]+)\n```[^\n]*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const filePath = m[1].trim();
    const code = m[2].trim();
    // Drop any path that is absolute or escapes the tree (path traversal guard).
    // Validated relative to a virtual root so "../" / "/etc/..." are rejected here.
    if (!filePath || path.isAbsolute(filePath) || /(^|[\\/])\.\.([\\/]|$)/.test(filePath.replace(/\\/g, '/'))) {
      log(`⚠  Skipping unsafe file path from model output: ${JSON.stringify(filePath)}`);
      continue;
    }
    files.push({ filePath, code });
  }
  return files;
}

export function saveFile(sessionDir: string, rel: string, content: string): string {
  const full = safeResolve(sessionDir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
  return full;
}
