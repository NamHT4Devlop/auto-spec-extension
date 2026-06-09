import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { listSessions, createSessionDir } from '../utils/session-store';

describe('createSessionDir', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should create session directory with subdirectories', () => {
    const dir = createSessionDir(tmpDir, 'sessions', 'test requirement');
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.existsSync(path.join(dir, '01-plan'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '07-evidence'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '08-files'))).toBe(true);
  });

  it('should include slug in directory name', () => {
    const dir = createSessionDir(tmpDir, 'sessions', 'Add user authentication');
    expect(path.basename(dir)).toContain('add-user-authentication');
  });
});

describe('listSessions', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-list-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return empty array when no sessions exist', () => {
    expect(listSessions(tmpDir, 'sessions')).toEqual([]);
  });

  it('should list sessions with state files', () => {
    const sessDir = path.join(tmpDir, 'sessions', 'test-session');
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessDir, '.pipeline-state.json'),
      JSON.stringify({
        requirement: 'test req',
        completedSteps: ['step-01', 'step-02'],
        timestamp: '2026-01-01T00:00:00Z',
      }),
    );

    const sessions = listSessions(tmpDir, 'sessions');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].requirement).toBe('test req');
    expect(sessions[0].completedSteps).toBe(2);
    expect(sessions[0].hasState).toBe(true);
  });

  it('should filter resumable only', () => {
    const dir1 = path.join(tmpDir, 'sessions', 'completed');
    const dir2 = path.join(tmpDir, 'sessions', 'in-progress');
    fs.mkdirSync(dir1, { recursive: true });
    fs.mkdirSync(dir2, { recursive: true });
    fs.writeFileSync(
      path.join(dir2, '.pipeline-state.json'),
      JSON.stringify({ requirement: 'wip', completedSteps: ['step-01'], timestamp: '2026-01-02' }),
    );

    const all = listSessions(tmpDir, 'sessions');
    expect(all).toHaveLength(2);

    const resumable = listSessions(tmpDir, 'sessions', true);
    expect(resumable).toHaveLength(1);
    expect(resumable[0].requirement).toBe('wip');
  });
});
