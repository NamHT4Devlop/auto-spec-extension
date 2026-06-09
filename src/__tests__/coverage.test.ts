import { parseCoverage } from '../utils/coverage';

describe('parseCoverage', () => {
  it('should parse Jest table format', () => {
    const output = `
----------|---------|----------|---------|---------|
File      | % Stmts | % Branch | % Funcs | % Lines |
----------|---------|----------|---------|---------|
All files |   85.71 |    66.67 |     100 |   85.71 |
----------|---------|----------|---------|---------|`;
    expect(parseCoverage(output)).toBe(85.71);
  });

  it('should parse pytest-cov format', () => {
    const output = `
Name                      Stmts   Miss  Cover
---------------------------------------------
mymodule/__init__.py          5      0   100%
mymodule/core.py             20      2    90%
---------------------------------------------
TOTAL                        25      2    92%`;
    expect(parseCoverage(output)).toBe(92);
  });

  it('should parse Istanbul format', () => {
    expect(parseCoverage('Lines   : 78.5% (120/153)')).toBe(78.5);
  });

  it('should return null when no coverage pattern matches', () => {
    expect(parseCoverage('no coverage data here')).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(parseCoverage('')).toBeNull();
  });
});
