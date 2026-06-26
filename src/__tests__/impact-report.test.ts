import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildImpactReport } from '../utils/graph-builder';

/** Build a throwaway project on disk for the static graph scanner to read. */
function makeFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impact-'));
  const src = path.join(dir, 'src');
  fs.mkdirSync(src, { recursive: true });

  fs.writeFileSync(path.join(src, 'user.repository.ts'), `
export class UserRepository {
  save(u: any) { return u; }
  findById(id: string) { return id; }
}
`);
  fs.writeFileSync(path.join(src, 'user.service.ts'), `
import { UserRepository } from './user.repository';
export class UserService {
  private userRepository: UserRepository;
  createUser(name: string) { return this.userRepository.save({ name }); }
}
`);
  // Two consumers that depend on UserService — the reverse edges we want surfaced.
  fs.writeFileSync(path.join(src, 'user.controller.ts'), `
import { UserService } from './user.service';
export class UserController {
  private userService: UserService;
  register(name: string) { return this.userService.createUser(name); }
}
`);
  fs.writeFileSync(path.join(src, 'auth.service.ts'), `
import { UserService } from './user.service';
export class AuthService {
  private userService: UserService;
  signup(name: string) { return this.userService.createUser(name); }
}
`);
  return dir;
}

describe('buildImpactReport — graph-aware impact for /build', () => {
  let dir: string;
  beforeAll(() => { dir = makeFixture(); });
  afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

  it('returns empty string when no seed files given', () => {
    expect(buildImpactReport(dir, [])).toBe('');
  });

  it('surfaces reverse dependencies (who uses the changed class)', () => {
    const report = buildImpactReport(dir, ['src/user.service.ts']);
    expect(report).toContain('STRUCTURAL IMPACT GRAPH');
    // Both consumers of UserService must appear as dependents.
    expect(report).toContain('UserController');
    expect(report).toContain('AuthService');
    // And it should show the section for the changed component itself.
    expect(report).toContain('UserService');
  });

  it('reports forward dependencies of the changed class', () => {
    const report = buildImpactReport(dir, ['src/user.service.ts']);
    // UserService depends on UserRepository (via DI / call).
    expect(report).toContain('UserRepository');
    expect(report.toLowerCase()).toContain('depends on');
  });

  it('returns empty for a seed file that does not exist in the graph', () => {
    expect(buildImpactReport(dir, ['src/does-not-exist.ts'])).toBe('');
  });
});
