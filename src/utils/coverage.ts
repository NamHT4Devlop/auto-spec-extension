export function parseCoverage(output: string): number | null {
  const patterns = [
    /All files\s*\|[^|]*\|[^|]*\|[^|]*\|\s*([\d.]+)/,   // Jest table
    /TOTAL\s+\d+\s+\d+\s+([\d.]+)%/,                      // pytest-cov
    /Lines\s*:\s*([\d.]+)%/,                               // Istanbul
    /Stmts\s+Miss\s+Cover[\s\S]*?TOTAL\s+\d+\s+\d+\s+(\d+)%/, // coverage.py
  ];
  for (const pat of patterns) {
    const m = output.match(pat);
    if (m) { return parseFloat(m[1]); }
  }
  return null;
}
