import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { extractFiles, saveFile } from '../utils/file-utils';

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
