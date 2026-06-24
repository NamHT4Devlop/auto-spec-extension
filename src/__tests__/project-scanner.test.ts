import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { discoverModules, scanModule } from '../utils/project-scanner';

describe('discoverModules', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-test-'));
    // src/orders (3 files), src/payments (2 files), src/utils-tiny (1 file -> below threshold)
    const mk = (rel: string, body = 'export const x = 1;') => {
      const f = path.join(root, rel);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, body);
    };
    mk('src/orders/order.service.ts');
    mk('src/orders/order.entity.ts');
    mk('src/orders/order.controller.ts');
    mk('src/payments/payment.service.ts');
    mk('src/payments/payment.entity.ts');
    mk('src/tiny/only.ts');
    mk('src/node_modules/junk/skip.ts'); // should be ignored
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('detects business modules with enough source files', () => {
    const mods = discoverModules(root);
    const names = mods.map(m => m.name);
    expect(names).toContain('orders');
    expect(names).toContain('payments');
  });

  it('orders modules by file count (largest first)', () => {
    const mods = discoverModules(root);
    expect(mods[0].name).toBe('orders'); // 3 files > 2
  });

  it('skips tiny dirs (< 2 files) and ignored dirs', () => {
    const names = discoverModules(root).map(m => m.name);
    expect(names).not.toContain('tiny');
    expect(names).not.toContain('node_modules');
  });

  it('scanModule reads only the given module subtree', () => {
    const out = scanModule(root, 'src/orders');
    expect(out).toContain('order.service.ts');
    expect(out).not.toContain('payment.service.ts');
  });
});
