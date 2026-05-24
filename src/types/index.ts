export interface ExtractedFile {
  filePath: string;
  code: string;
}

export interface TestResult {
  passed: boolean;
  skipped: boolean;
  output: string;
  coverage: number | null;
  durationMs: number;
  command: string;
}
