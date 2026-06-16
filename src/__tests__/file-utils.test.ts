import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { extractFiles, saveFile, safeResolve, isSafeRelativePath } from '../utils/file-utils';

describe('extractFiles', () => {
  it('should extract files from markdown code blocks', () => {
    const content = `
### FILE: src/utils/helper.ts
\`\`\`typescript
export function helper() { return true; }
\`\`\`

### FILE: src/models/user.ts
\`\`\`typescript
export interface User { id: string; name: string; }
\`\`\`
`;
    const files = extractFiles(content);
    expect(files).toHaveLength(2);
    expect(files[0].filePath).toBe('src/utils/helper.ts');
    expect(files[0].code).toContain('helper');
    expect(files[1].filePath).toBe('src/models/user.ts');
    expect(files[1].code).toContain('User');
  });

  it('should return empty array when no files found', () => {
    expect(extractFiles('no code blocks here')).toEqual([]);
  });

  it('should handle code blocks without language tag', () => {
    const content = `
### FILE: config.json
\`\`\`
{ "key": "value" }
\`\`\`
`;
    const files = extractFiles(content);
    expect(files).toHaveLength(1);
    expect(files[0].filePath).toBe('config.json');
  });

  it('should drop path-traversal and absolute paths (security)', () => {
    const content = `
### FILE: ../../etc/passwd
\`\`\`
pwned
\`\`\`

### FILE: /tmp/evil.sh
\`\`\`
pwned
\`\`\`

### FILE: src/safe.ts
\`\`\`
export const ok = true;
\`\`\`
`;
    const files = extractFiles(content);
    expect(files).toHaveLength(1);
    expect(files[0].filePath).toBe('src/safe.ts');
  });
});

describe('safeResolve (path traversal guard)', () => {
  const root = path.join(os.tmpdir(), 'ask-root');

  it('resolves in-tree relative paths', () => {
    expect(safeResolve(root, 'a/b/c.ts')).toBe(path.resolve(root, 'a/b/c.ts'));
  });

  it('rejects parent-directory traversal', () => {
    expect(() => safeResolve(root, '../escape.ts')).toThrow();
    expect(() => safeResolve(root, 'a/../../escape.ts')).toThrow();
  });

  it('rejects absolute paths', () => {
    expect(() => safeResolve(root, '/etc/passwd')).toThrow();
  });

  it('isSafeRelativePath reflects the guard', () => {
    expect(isSafeRelativePath(root, 'ok/file.ts')).toBe(true);
    expect(isSafeRelativePath(root, '../nope.ts')).toBe(false);
    expect(isSafeRelativePath(root, '/abs.ts')).toBe(false);
  });
});

describe('saveFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should create file with nested directories', () => {
    const result = saveFile(tmpDir, 'deep/nested/file.txt', 'hello');
    expect(fs.existsSync(result)).toBe(true);
    expect(fs.readFileSync(result, 'utf-8')).toBe('hello');
  });

  it('should return the full path', () => {
    const result = saveFile(tmpDir, 'test.md', 'content');
    expect(result).toBe(path.join(tmpDir, 'test.md'));
  });
});
