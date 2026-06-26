/**
 * graph-builder.ts — Universal Multi-Language Deep Graph Scanner
 *
 * Works for ANY project: TS/JS, Python, Java, Go, Ruby, C#, PHP, Rust.
 *
 * 3 analysis layers:
 *   Layer 1 — Static: file imports, class hierarchy, function declarations
 *   Layer 2 — Deep:   method calls, entity fields, API routes, DI wiring
 *   Layer 3 — AI:     business flow inference, entity relationships, architecture classification
 *                     (optional — requires model + token, runs via AgentOrchestrator)
 *
 * Output: GraphData JSON consumed by html-builder.ts → D3.js force graph
 */

import * as fs from 'fs';
import * as path from 'path';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type NodeType =
  | 'file' | 'class' | 'interface' | 'function' | 'method'
  | 'entity' | 'controller' | 'service' | 'repository'
  | 'middleware' | 'route' | 'config' | 'test'
  | 'kb-topic' | 'kb-section'
  | 'module';

export type NodeLayer =
  | 'presentation' | 'business' | 'data' | 'infrastructure'
  | 'domain' | 'test' | 'config' | 'external';

export type EdgeType =
  | 'imports' | 'calls' | 'extends' | 'implements'
  | 'depends' | 'injects' | 'emits' | 'listens'
  | 'has-field' | 'relates-to' | 'defines'
  | 'flows-to' | 'reads' | 'writes' | 'tests';

export interface GraphNode {
  id: string;
  label: string;
  type: NodeType;
  layer: NodeLayer;
  description: string;
  file?: string;          // relative path to source file
  line?: number;          // line number in source
  language?: string;      // detected language
  details?: string;       // extra info (signature, fields, etc.)
  size?: number;          // 1-5, relative importance
  methods?: string[];     // for class nodes — list of method names
  fields?: string[];      // for entity nodes — list of field names
}

export interface GraphEdge {
  source: string;
  target: string;
  type: EdgeType;
  label?: string;
  weight?: number;        // 1-3, strength of relationship
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  layers: { id: NodeLayer; label: string; color: string }[];
  metadata: {
    projectName: string;
    generatedAt: string;
    nodeCount: number;
    edgeCount: number;
    languages: string[];
    scanDurationMs: number;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

export const LAYER_CONFIG: Record<NodeLayer, { label: string; color: string }> = {
  presentation:    { label: 'Presentation',     color: '#4f8ef7' },
  business:        { label: 'Business Logic',   color: '#34c78a' },
  data:            { label: 'Data Layer',       color: '#9b59b6' },
  infrastructure:  { label: 'Infrastructure',   color: '#f7a34f' },
  domain:          { label: 'Domain / KB',      color: '#e74c3c' },
  test:            { label: 'Tests',            color: '#1abc9c' },
  config:          { label: 'Config',           color: '#95a5a6' },
  external:        { label: 'External',         color: '#7f8c8d' },
};

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '__pycache__',
  '.next', '.nuxt', 'coverage', 'spec-kit-sessions', 'knowledge-base',
  '.vscode', '.idea', 'vendor', 'target', '.gradle', 'bin', 'obj',
  'venv', '.venv', 'env', '.env', 'Pods', '.dart_tool',
]);

const SKIP_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  '.DS_Store', 'Thumbs.db',
]);

// ═══════════════════════════════════════════════════════════════════════════════
// LANGUAGE DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

type LangId = 'typescript' | 'javascript' | 'python' | 'java' | 'go' | 'ruby' | 'csharp' | 'php' | 'rust' | 'unknown';

const EXT_TO_LANG: Record<string, LangId> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python',
  '.java': 'java', '.kt': 'java',
  '.go': 'go',
  '.rb': 'ruby',
  '.cs': 'csharp',
  '.php': 'php',
  '.rs': 'rust',
};

function detectLang(filePath: string): LangId {
  return EXT_TO_LANG[path.extname(filePath).toLowerCase()] ?? 'unknown';
}

// ═══════════════════════════════════════════════════════════════════════════════
// MULTI-LANGUAGE PARSERS
// ═══════════════════════════════════════════════════════════════════════════════

interface ParsedFile {
  relPath: string;
  language: LangId;
  imports: string[];                 // resolved relative import paths
  classes: ParsedClass[];
  functions: ParsedFunction[];
  exports: string[];                 // exported names
  routes: ParsedRoute[];            // API endpoints found
  decorators: string[];             // @Controller, @Injectable, etc.
}

interface ParsedClass {
  name: string;
  line: number;
  kind?: 'class' | 'interface' | 'enum' | 'trait';
  extends?: string;
  implements: string[];
  methods: ParsedFunction[];
  fields: { name: string; type?: string }[];
  decorators: string[];
  /** Extracted Javadoc/JSDoc/docstring summary for use as node description. */
  docComment?: string;
}

interface ParsedFunction {
  name: string;
  line: number;
  isAsync: boolean;
  params: string;
  calls: string[];                   // function/method names called within body
}

interface ParsedRoute {
  method: string;                    // GET, POST, PUT, DELETE, PATCH
  path: string;
  handler: string;
  line: number;
}

// ── Import patterns per language ──────────────────────────────────────────────

const IMPORT_PATTERNS: Record<LangId, RegExp[]> = {
  typescript: [
    /from\s+['"](\.\.?\/[^'"]+)['"]/g,                        // import { x } from './y'
    /require\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g,              // require('./y')
  ],
  javascript: [
    /from\s+['"](\.\.?\/[^'"]+)['"]/g,
    /require\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g,
  ],
  python: [
    /^from\s+([\w.]+)\s+import/gm,                             // from module import x
    /^import\s+([\w.]+)/gm,                                    // import module
  ],
  java: [
    /^import\s+([\w.]+);/gm,                                  // import com.pkg.Class;
  ],
  go: [
    /^\s+"([^"]+)"/gm,                                        // "github.com/pkg/name"
  ],
  ruby: [
    /^require\s+['"]([\w\/]+)['"]/gm,                         // require 'module'
    /^require_relative\s+['"]([\w\/]+)['"]/gm,                // require_relative './file'
  ],
  csharp: [
    /^using\s+([\w.]+);/gm,                                   // using Namespace;
  ],
  php: [
    /^use\s+([\w\\]+)/gm,                                     // use Namespace\Class;
    /require(?:_once)?\s*['"]([\w\/.-]+)['"]/g,               // require 'file.php'
  ],
  rust: [
    /^use\s+([\w:]+)/gm,                                      // use crate::module;
    /^mod\s+(\w+)/gm,                                         // mod module;
  ],
  unknown: [],
};

// ── Class patterns per language ───────────────────────────────────────────────

const CLASS_PATTERN: Record<LangId, RegExp> = {
  // class, interface, enum — handles export/declare/abstract modifiers.
  // Generics on extends consumed non-captively so m[2] is always a plain name.
  typescript:  /^(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:class|interface|enum)\s+(\w+)(?:\s+extends\s+([\w]+)(?:<[^>]*>)?)?(?:\s+implements\s+([\w,\s.]+?))?/gm,
  javascript:  /^(?:export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/gm,
  python:      /^class\s+(\w+)(?:\(([\w,\s.]+)\))?:/gm,
  // Matches class, interface, enum — handles public/protected/abstract/final/static modifiers.
  java:        /^(?:(?:public|protected|private|abstract|final|static)\s+)*(?:class|interface|enum)\s+(\w+)(?:\s+extends\s+([\w.]+)(?:<[^>]*>)?)?(?:\s+implements\s+([\w.,\s]+?))?(?:\s*\{)/gm,
  // struct and interface types
  go:          /^type\s+(\w+)\s+(?:struct|interface)/gm,
  ruby:        /^class\s+(\w+)(?:\s*<\s*(\w+))?/gm,
  // class, interface, enum, record, struct — all C# type declarations
  csharp:      /^(?:(?:public|private|protected|internal|abstract|sealed|static|partial|readonly)\s+)*(?:class|interface|enum|record|struct)\s+(\w+)(?:\s*:\s*([\w<>,\s.]+?))?/gm,
  // class, interface, trait — handles abstract/final/readonly modifiers
  php:         /^(?:(?:abstract|final|readonly)\s+)?(?:class|interface|trait)\s+(\w+)(?:\s+extends\s+([\w\\]+))?(?:\s+implements\s+([\w\\,\s]+))?/gm,
  // struct, enum, trait — all Rust named type declarations
  rust:        /^(?:pub(?:\s*\([^)]*\))?\s+)?(?:struct|enum|trait)\s+(\w+)/gm,
  unknown:     /(?!)/g, // never matches
};

// ── Function patterns per language ────────────────────────────────────────────

const FUNCTION_PATTERN: Record<LangId, RegExp> = {
  typescript:  /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)|(\w+)\s*(?::\s*\w+\s*)?=\s*(?:async\s+)?\([^)]*\)\s*(?::\s*\w+\s*)?=>/gm,
  javascript:  /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)|(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/gm,
  python:      /^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/gm,
  java:        /(?:public|private|protected)\s+(?:static\s+)?(?:\w+\s+)(\w+)\s*\(([^)]*)\)/gm,
  go:          /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(([^)]*)\)/gm,
  ruby:        /^\s*def\s+(\w+[?!]?)/gm,
  csharp:      /(?:public|private|protected)\s+(?:static\s+)?(?:async\s+)?(?:\w+\s+)(\w+)\s*\(([^)]*)\)/gm,
  php:         /(?:public|private|protected)\s+(?:static\s+)?function\s+(\w+)\s*\(([^)]*)\)/gm,
  rust:        /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*\(([^)]*)\)/gm,
  unknown:     /(?!)/g,
};

// ── Route/endpoint patterns ───────────────────────────────────────────────────

const ROUTE_PATTERNS: RegExp[] = [
  // Express/Koa/Fastify: app.get('/path', handler)
  /(?:app|router|server)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
  // Decorators: @Get('/path'), @Post('/path')
  /@(Get|Post|Put|Delete|Patch)\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/gi,
  // Python Flask/FastAPI: @app.route('/path'), @router.get('/path')
  /@(?:app|router)\.(route|get|post|put|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
  // Java Spring: @GetMapping("/path"), @RequestMapping
  /@(GetMapping|PostMapping|PutMapping|DeleteMapping|RequestMapping)\s*\(\s*(?:value\s*=\s*)?['"`]([^'"`]+)['"`]/gi,
  // Go: r.GET("/path", handler)
  /\.(GET|POST|PUT|DELETE|PATCH)\s*\(\s*"([^"]+)"/gi,
  // Ruby Rails: get '/path', to: 'controller#action'
  /^\s*(get|post|put|patch|delete)\s+['"]([^'"]+)['"]/gim,
];

// ── Decorator patterns ────────────────────────────────────────────────────────

const DECORATOR_PATTERN = /@(\w+)\s*(?:\([^)]*\))?/g;

// ═══════════════════════════════════════════════════════════════════════════════
// FILE SCANNER
// ═══════════════════════════════════════════════════════════════════════════════

function walkSourceFiles(rootDir: string, maxDepth = 8): string[] {
  const files: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) { return; }
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.env.example') { continue; }
      if (SKIP_FILES.has(e.name)) { continue; }
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) { walk(full, depth + 1); }
      } else {
        const lang = detectLang(e.name);
        if (lang !== 'unknown') { files.push(full); }
      }
    }
  };
  walk(rootDir, 0);
  return files;
}

function readSafe(p: string): string {
  try { return fs.readFileSync(p, 'utf8'); }
  catch { return ''; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARSE A SINGLE FILE
// ═══════════════════════════════════════════════════════════════════════════════

function parseFile(absPath: string, rootDir: string): ParsedFile {
  const relPath = path.relative(rootDir, absPath).replace(/\\/g, '/');
  const language = detectLang(absPath);
  const content = readSafe(absPath);
  const lines = content.split('\n');

  // ── Imports ──
  const imports: string[] = [];
  const patterns = IMPORT_PATTERNS[language] ?? [];
  for (const pat of patterns) {
    pat.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.exec(content)) !== null) {
      imports.push(m[1]);
    }
  }

  // ── Classes ──
  const classes: ParsedClass[] = [];
  const classRe = CLASS_PATTERN[language];
  if (classRe) {
    classRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = classRe.exec(content)) !== null) {
      const lineNum = content.slice(0, m.index).split('\n').length;
      const className = m[1];
      const extendsName = m[2]?.trim();
      const implStr = m[3] ?? '';
      const impls = implStr ? implStr.split(',').map(s => s.trim()).filter(Boolean) : [];

      // Determine kind from the matched keyword
      const kw = m[0];
      const kind: ParsedClass['kind'] =
        /\binterface\b/.test(kw) ? 'interface' :
        /\benum\b/.test(kw) ? 'enum' :
        /\btrait\b/.test(kw) ? 'trait' : 'class';

      // Find methods within class body (simplified — look for method-like patterns after class declaration)
      const classBody = extractBlock(content, m.index);
      const methods = parseFunctionsInBlock(classBody, language, lineNum);

      // Find fields (simplified)
      const fields = parseFields(classBody, language);

      // Find decorators above class
      const decorators = findDecoratorsAbove(lines, lineNum - 1);
      // Extract doc comment for the node description
      const docComment = extractDocComment(lines, lineNum);

      classes.push({
        name: className,
        line: lineNum,
        kind,
        extends: extendsName || undefined,
        implements: impls,
        methods,
        fields,
        decorators,
        docComment: docComment || undefined,
      });
    }
  }

  // ── Top-level functions ──
  const functions: ParsedFunction[] = [];
  const funcRe = FUNCTION_PATTERN[language];
  if (funcRe) {
    funcRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = funcRe.exec(content)) !== null) {
      const name = m[1] || m[3];
      if (!name) { continue; }
      const lineNum = content.slice(0, m.index).split('\n').length;
      // Skip if inside a class body (already captured)
      if (classes.some(c => lineNum > c.line && lineNum < c.line + 200)) { continue; }

      const body = extractBlock(content, m.index);
      const calls = extractCalls(body, language);

      functions.push({
        name,
        line: lineNum,
        isAsync: /async/.test(m[0]),
        params: m[2] ?? '',
        calls,
      });
    }
  }

  // ── Exports ──
  const exports: string[] = [];
  const exportRe = /export\s+(?:default\s+)?(?:class|function|const|let|var|interface|type|enum)\s+(\w+)/g;
  let em: RegExpExecArray | null;
  while ((em = exportRe.exec(content)) !== null) {
    exports.push(em[1]);
  }

  // ── Routes ──
  const routes: ParsedRoute[] = [];
  for (const routeRe of ROUTE_PATTERNS) {
    routeRe.lastIndex = 0;
    let rm: RegExpExecArray | null;
    while ((rm = routeRe.exec(content)) !== null) {
      const method = rm[1].toUpperCase().replace('MAPPING', '');
      routes.push({
        method: method === 'ROUTE' ? 'GET' : method,
        path: rm[2],
        handler: relPath,
        line: content.slice(0, rm.index).split('\n').length,
      });
    }
  }

  // ── Decorators (file level) ──
  const decorators: string[] = [];
  DECORATOR_PATTERN.lastIndex = 0;
  let dm: RegExpExecArray | null;
  while ((dm = DECORATOR_PATTERN.exec(content)) !== null) {
    if (!decorators.includes(dm[1])) { decorators.push(dm[1]); }
  }

  return { relPath, language, imports, classes, functions, exports, routes, decorators };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function extractBlock(content: string, startIdx: number): string {
  // 800 lines to capture methods across large Java service/controller classes.
  const rest = content.slice(startIdx);
  const lines = rest.split('\n').slice(0, 800);
  return lines.join('\n');
}

function parseFunctionsInBlock(block: string, lang: LangId, baseLineNum: number): ParsedFunction[] {
  const methods: ParsedFunction[] = [];
  const methodPatterns: Record<string, RegExp> = {
    typescript:  /(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*(?::\s*[\w<>\[\]|]+\s*)?[{]/g,
    javascript:  /(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*[{]/g,
    python:      /def\s+(\w+)\s*\(([^)]*)\)/g,
    java:        /(?:public|private|protected)\s+(?:\w+\s+)(\w+)\s*\(([^)]*)\)/g,
    go:          /func\s+(\w+)\s*\(([^)]*)\)/g,
    ruby:        /def\s+(\w+[?!]?)/g,
    csharp:      /(?:public|private)\s+(?:\w+\s+)(\w+)\s*\(([^)]*)\)/g,
    php:         /function\s+(\w+)\s*\(([^)]*)\)/g,
    rust:        /fn\s+(\w+)\s*\(([^)]*)\)/g,
  };

  const re = methodPatterns[lang];
  if (!re) { return methods; }
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const name = m[1];
    if (['constructor', 'if', 'for', 'while', 'switch', 'catch'].includes(name)) { continue; }
    const bodyChunk = block.slice(m.index, m.index + 500);
    methods.push({
      name,
      line: baseLineNum + block.slice(0, m.index).split('\n').length - 1,
      isAsync: /async/.test(m[0]),
      params: m[2] ?? '',
      calls: extractCalls(bodyChunk, lang),
    });
  }
  return methods;
}

// Noise words filtered from extracted call lists — covers all 9 supported languages.
const CALL_NOISE = new Set([
  // JS/TS
  'function', 'class', 'import', 'require', 'from', 'return',
  'console', 'if', 'for', 'while', 'switch', 'catch', 'new', 'throw', 'typeof',
  'async', 'await', 'super', 'constructor', 'Object', 'Array', 'String', 'Number',
  'parseInt', 'parseFloat', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol',
  'JSON', 'Math', 'Date', 'Error', 'RegExp', 'Boolean', 'Buffer',
  'process', 'module', 'exports',
  // Java
  'System', 'Optional', 'Arrays', 'Collections', 'Objects', 'StringBuilder',
  'ArrayList', 'HashMap', 'HashSet', 'LinkedList', 'stream', 'collect',
  'toString', 'equals', 'hashCode', 'getClass', 'notify', 'wait',
  // Python
  'print', 'len', 'range', 'list', 'dict', 'tuple', 'set', 'str', 'int', 'float',
  'bool', 'type', 'isinstance', 'hasattr', 'getattr', 'setattr', 'open',
  'enumerate', 'zip', 'map', 'filter', 'sorted', 'reversed', 'sum', 'max', 'min',
  'staticmethod', 'classmethod', 'property',
  // Go
  'make', 'append', 'cap', 'delete', 'copy', 'close', 'panic', 'recover',
  'Println', 'Printf', 'Sprintf', 'Errorf',
  // Ruby
  'puts', 'raise', 'rescue', 'require', 'require_relative',
  // C#
  'Console', 'Task', 'List', 'Dictionary', 'IEnumerable', 'Where', 'Select',
  // General utilities
  'log', 'info', 'warn', 'debug', 'error', 'trace', 'fatal',
  'get', 'set', 'add', 'put', 'has', 'len',
  'push', 'pop', 'shift', 'splice', 'slice', 'join', 'split',
  'trim', 'replace', 'test', 'match', 'exec',
  'read', 'write',
]);

function extractCalls(body: string, _lang: LangId): string[] {
  const calls = new Set<string>();
  const re = /(?:(?:this|self|\w+)\.)?(\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const name = m[1];
    if (name.length > 2 && !CALL_NOISE.has(name)) { calls.add(name); }
  }
  return Array.from(calls);
}

function parseFields(block: string, lang: LangId): { name: string; type?: string }[] {
  const fields: { name: string; type?: string }[] = [];

  if (lang === 'typescript' || lang === 'javascript') {
    const re = /(?:readonly\s+)?(?:private\s+|public\s+|protected\s+)?(\w+)\s*[?!]?\s*:\s*([\w<>\[\]|.]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block)) !== null) { fields.push({ name: m[1], type: m[2] }); }

  } else if (lang === 'python') {
    const re = /self\.(\w+)\s*(?::\s*([\w.\[\]]+))?\s*=/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block)) !== null) { fields.push({ name: m[1], type: m[2] }); }

  } else if (lang === 'java' || lang === 'csharp') {
    const re = /(?:private|public|protected)\s+([\w<>\[\]]+)\s+(\w+)\s*[;=]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block)) !== null) { fields.push({ name: m[2], type: m[1] }); }

  } else if (lang === 'php') {
    // PHP 7.4+ typed properties: private ?UserRepository $repo;
    const re = /(?:private|protected|public)\s+(?:\??([\w\\]+)\s+)?\$(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block)) !== null) { fields.push({ name: m[2], type: m[1] || undefined }); }

  } else if (lang === 'go') {
    // Tab-indented struct fields: FieldName Type or FieldName *Type
    const re = /^\t([A-Za-z]\w*)\s+(\*?[\w.[\]]+)/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block)) !== null) {
      const name = m[1];
      // Skip Go keywords that appear inside method bodies captured by extractBlock
      if (['func', 'var', 'const', 'type', 'return', 'if', 'for', 'case', 'default', 'range'].includes(name)) { continue; }
      fields.push({ name, type: m[2] });
    }

  } else if (lang === 'rust') {
    // Struct fields: field_name: Type  or  pub field_name: Arc<Type>
    const re = /^\s+(?:pub\s+)?(\w+)\s*:\s*(?:(?:Arc|Box|Rc|Option|Vec|Mutex|RwLock|RefCell)<\s*)?(\w+)/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block)) !== null) {
      const name = m[1];
      if (['fn', 'let', 'if', 'for', 'while', 'match', 'use', 'pub', 'mod', 'impl', 'return', 'mut', 'self'].includes(name)) { continue; }
      fields.push({ name, type: m[2] });
    }

  } else if (lang === 'ruby') {
    // attr_accessor/reader/writer declares fields (no type info in Ruby)
    const re = /attr_(?:accessor|reader|writer)\s+:(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block)) !== null) { fields.push({ name: m[1] }); }
  }

  return fields.slice(0, 30);
}

function findDecoratorsAbove(lines: string[], lineIdx: number): string[] {
  const decs: string[] = [];
  for (let i = lineIdx - 1; i >= Math.max(0, lineIdx - 5); i--) {
    const dec = lines[i]?.match(/@(\w+)/);
    if (dec) { decs.push(dec[1]); }
    else if (lines[i]?.trim() && !lines[i]?.trim().startsWith('//') && !lines[i]?.trim().startsWith('*')) { break; }
  }
  return decs;
}

/**
 * Extract the Javadoc / JSDoc / Python docstring immediately above a declaration.
 * Returns a plain-text summary ≤200 chars for use as the node description.
 */
function extractDocComment(lines: string[], declLineIdx: number): string {
  // declLineIdx is 1-based (from content.split('\n').length)
  const idx = declLineIdx - 1;
  const collected: string[] = [];
  let insideBlock = false;

  for (let i = idx - 1; i >= Math.max(0, idx - 25); i--) {
    const raw = lines[i] ?? '';
    const t = raw.trim();
    if (!t) { continue; }

    // End of block comment found going upward — we're now inside it
    if (t === '*/' || t.endsWith('*/')) { insideBlock = true; continue; }
    if (insideBlock) {
      if (t.startsWith('/**') || t.startsWith('/*')) { break; } // reached the start
      // Strip leading * and @tag lines
      const clean = t.replace(/^\*+\s?/, '');
      if (!clean.startsWith('@') && clean.length > 0) { collected.unshift(clean); }
      continue;
    }
    // Single-line comment
    if (t.startsWith('///') || t.startsWith('//')) {
      collected.unshift(t.replace(/^\/+\s?/, ''));
      continue;
    }
    // Python triple-quote on the next line after the def
    if (t.startsWith('"""') || t.startsWith("'''")) {
      collected.unshift(t.replace(/^['"]{3}|['"]{3}$/g, '').trim());
      break;
    }
    // Annotation / decorator — keep going upward
    if (t.startsWith('@')) { continue; }
    // Anything else (code, blank-ish) — stop
    break;
  }

  return collected.join(' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ARCHITECTURE LAYER AUTO-DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

function inferLayer(relPath: string, parsed: ParsedFile): NodeLayer {
  const lower = relPath.toLowerCase();
  const decs = parsed.decorators.map(d => d.toLowerCase());
  const allDecs = [...decs, ...parsed.classes.flatMap(c => c.decorators.map(d => d.toLowerCase()))];

  // Tests
  if (/\.test\.|\.spec\.|__tests__|_test\.|test_/.test(lower)) { return 'test'; }

  // Config
  if (/config|\.env|docker|\.ya?ml$|\.toml$|\.ini$|webpack|vite\.config|jest\.config|babel/.test(lower)) { return 'config'; }

  // Presentation (controllers, routes, views, components, pages)
  // 'resource' covers Spring REST @RestController classes often named *Resource
  if (/controller|handler|route|resolver|page|view|component|screen|widget|resource/.test(lower)) { return 'presentation'; }
  if (allDecs.some(d => ['controller', 'restcontroller', 'get', 'post', 'put', 'delete', 'resolver', 'component', 'requestmapping'].includes(d))) { return 'presentation'; }
  if (parsed.routes.length > 0) { return 'presentation'; }

  // Data layer (repositories, DAOs, migrations, schemas, ORM)
  // 'mapper' covers MyBatis mapper interfaces and MapStruct mapper classes
  if (/repository|repo|dao|migration|schema|seed|fixture|prisma|sequelize|typeorm|mapper/.test(lower)) { return 'data'; }
  if (allDecs.some(d => ['entity', 'table', 'column', 'model', 'schema', 'repository', 'mapper'].includes(d))) { return 'data'; }

  // Domain (entities, models, DTOs, enums, value objects)
  if (/entity|model|dto|enum|interface|types?\/|domain|aggregate|value.?object/.test(lower)) { return 'domain'; }

  // Infrastructure (middleware, guards, pipes, interceptors, adapters, gateways)
  if (/middleware|guard|pipe|interceptor|adapter|gateway|filter|plugin|provider|factory|strategy/.test(lower)) { return 'infrastructure'; }
  if (allDecs.some(d => ['injectable', 'middleware', 'guard', 'pipe', 'interceptor'].includes(d))) { return 'infrastructure'; }

  // Business logic (services, use cases, commands, queries, jobs, workers)
  if (/service|usecase|use-case|command|query|job|worker|task|processor|manager|engine|helper/.test(lower)) { return 'business'; }
  if (allDecs.some(d => ['injectable', 'service'].includes(d))) { return 'business'; }

  return 'business'; // default
}

function inferNodeType(parsed: ParsedFile, cls?: ParsedClass): NodeType {
  const className = cls?.name;
  const lower = parsed.relPath.toLowerCase();
  const decs = (className
    ? cls?.decorators ?? []
    : parsed.decorators
  ).map(d => d.toLowerCase());

  if (/\.test\.|\.spec\.|Test\.java$|Tests\.java$|IT\.java$/.test(parsed.relPath)) { return 'test'; }

  // Interfaces and traits are typed as 'interface'
  if (cls?.kind === 'interface' || cls?.kind === 'trait') { return 'interface'; }

  // Spring REST resource classes (*Resource.java) are controllers
  if (/controller|resource/.test(lower) || decs.some(d => ['controller', 'restcontroller', 'requestmapping'].includes(d))) { return 'controller'; }
  if (/service/.test(lower) || decs.some(d => ['injectable', 'service'].includes(d))) { return 'service'; }
  // Spring Data / MyBatis / DAO interfaces and implementations
  if (/repository|repo|dao|mapper/.test(lower) || decs.includes('repository')) { return 'repository'; }
  if (/entity|model/.test(lower) || decs.some(d => ['entity', 'model', 'document'].includes(d))) { return 'entity'; }
  if (/middleware|guard|pipe|interceptor|filter/.test(lower)) { return 'middleware'; }
  if (parsed.routes.length > 0) { return 'controller'; }
  if (className) { return 'class'; }
  return 'file';
}

// ═══════════════════════════════════════════════════════════════════════════════
// GRAPH CONSTRUCTION
// ═══════════════════════════════════════════════════════════════════════════════

function buildStaticGraph(rootDir: string): {
  nodes: GraphNode[];
  edges: GraphEdge[];
  parsedFiles: ParsedFile[];
  languages: Set<string>;
} {
  const files = walkSourceFiles(rootDir);
  const parsedFiles: ParsedFile[] = [];
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();
  const languages = new Set<string>();

  // Parse all files
  for (const absPath of files) {
    try {
      const parsed = parseFile(absPath, rootDir);
      parsedFiles.push(parsed);
      languages.add(parsed.language);
    } catch { /* skip unparseable files */ }
  }

  // Build file-level node map for import resolution
  const fileMap = new Map<string, ParsedFile>();
  for (const pf of parsedFiles) {
    const key = pf.relPath.replace(/\.[^.]+$/, ''); // strip extension
    fileMap.set(key, pf);
    fileMap.set(pf.relPath, pf);
  }

  // Symbol maps so NON-relative imports (Java `import com.app.UserService;`,
  // Ruby `require 'app/user_service'`, Python `from app.services import X`) still
  // produce edges — otherwise polyglot graphs look disconnected.
  const classNameToFileId = new Map<string, string>();
  const basenameToFileId = new Map<string, string>();
  for (const pf of parsedFiles) {
    const fid = `file:${pf.relPath}`;
    const base = path.basename(pf.relPath, path.extname(pf.relPath)).toLowerCase();
    if (!basenameToFileId.has(base)) { basenameToFileId.set(base, fid); }
    for (const c of pf.classes) {
      if (!classNameToFileId.has(c.name)) { classNameToFileId.set(c.name, fid); }
      classNameToFileId.set(c.name.toLowerCase(), fid);
    }
  }

  for (const pf of parsedFiles) {
    const layer = inferLayer(pf.relPath, pf);
    const fileId = `file:${pf.relPath}`;

    // ── File node ──
    const allMethods = [
      ...pf.functions.map(f => f.name),
      ...pf.classes.flatMap(c => c.methods.map(m => m.name)),
    ];

    nodes.push({
      id: fileId,
      label: path.basename(pf.relPath, path.extname(pf.relPath)),
      type: inferNodeType(pf, undefined),
      layer,
      description: pf.relPath,
      file: pf.relPath,
      language: pf.language,
      size: pf.classes.length > 0 ? 4 : pf.routes.length > 0 ? 4 : 3,
      methods: allMethods.slice(0, 20),
    });
    nodeIds.add(fileId);

    // ── Class nodes ──
    for (const cls of pf.classes) {
      const classId = `class:${pf.relPath}:${cls.name}`;
      const decoratorStr = cls.decorators.length > 0 ? `@${cls.decorators.join(' @')}` : '';
      nodes.push({
        id: classId,
        label: cls.name,
        type: inferNodeType(pf, cls),
        layer,
        // Prefer Javadoc/JSDoc description; fall back to path
        description: cls.docComment || `${cls.name} — ${pf.relPath}`,
        file: pf.relPath,
        line: cls.line,
        language: pf.language,
        size: cls.methods.length > 5 ? 5 : cls.methods.length > 2 ? 4 : 3,
        methods: cls.methods.map(m => m.name),
        fields: cls.fields.map(f => `${f.name}${f.type ? ': ' + f.type : ''}`),
        details: decoratorStr || undefined,
      });
      nodeIds.add(classId);

      // File → defines → Class
      edges.push({ source: fileId, target: classId, type: 'defines' });

      // Class extends
      if (cls.extends) {
        const parentId = findClassId(parsedFiles, cls.extends);
        if (parentId) {
          edges.push({ source: classId, target: parentId, type: 'extends', weight: 3 });
        }
      }

      // Class implements
      for (const iface of cls.implements) {
        const ifaceId = findClassId(parsedFiles, iface);
        if (ifaceId) {
          edges.push({ source: classId, target: ifaceId, type: 'implements', weight: 2 });
        }
      }

      // ── Spring / NestJS / Angular / Go / Rust DI: field injection edges ──
      // If a field's type matches a known class in the project, add an `injects` edge.
      for (const field of cls.fields) {
        if (!field.type) { continue; }
        // If generic, prefer the inner type: List<UserService> → UserService
        const innerMatch = field.type.match(/<\s*(\w+)/);
        const baseType = (innerMatch ? innerMatch[1] : field.type)
          .replace(/\[\]$/, '')      // Java/TS arrays
          .replace(/^\*+/, '')       // Go pointer *Type
          .replace(/^&(?:mut\s+)?/, '') // Rust reference &Type / &mut Type
          .trim();
        if (baseType.length < 2) { continue; }
        const targetClassId =
          classNameToFileId.get(baseType) ||
          classNameToFileId.get(baseType.toLowerCase());
        if (targetClassId && targetClassId !== fileId) {
          edges.push({
            source: classId,
            target: targetClassId,
            type: 'injects',
            label: field.name,
            weight: 3,
          });
        }
      }
    }

    // ── Route nodes ──
    for (const route of pf.routes) {
      const routeId = `route:${route.method}:${route.path}`;
      if (!nodeIds.has(routeId)) {
        nodes.push({
          id: routeId,
          label: `${route.method} ${route.path}`,
          type: 'route',
          layer: 'presentation',
          description: `${route.method} ${route.path} → ${pf.relPath}`,
          file: pf.relPath,
          line: route.line,
          size: 3,
        });
        nodeIds.add(routeId);
      }
      edges.push({ source: routeId, target: fileId, type: 'calls', label: 'handles' });
    }

    // ── Import edges ──
    for (const imp of pf.imports) {
      const resolved = resolveImport(pf.relPath, imp, fileMap);
      if (resolved) {
        edges.push({ source: fileId, target: `file:${resolved}`, type: 'imports' });
        continue;
      }
      // Non-relative import (Java/Ruby/Python/C#/PHP): resolve by last symbol/basename.
      const seg = imp.split(/[.\/:\\]/).filter(Boolean).pop();
      if (!seg) { continue; }
      const targetFileId =
        classNameToFileId.get(seg) ||
        classNameToFileId.get(seg.toLowerCase()) ||
        basenameToFileId.get(seg.toLowerCase());
      if (targetFileId && targetFileId !== fileId) {
        edges.push({ source: fileId, target: targetFileId, type: 'imports' });
      }
    }

    // ── Method call edges (cross-file, DI-guided) ──
    // For each class, build a set of "known dependency class IDs" from its injected fields.
    // This lets us prefer a matching DI target over a random class with the same method name.
    for (const cls of pf.classes) {
      const classId = `class:${pf.relPath}:${cls.name}`;
      // Collect types of injected dependencies for this class
      const injectedTargetIds = new Set<string>(
        cls.fields
          .map(f => {
            const raw = f.type ?? '';
            const innerM = raw.match(/<\s*(\w+)/);
            const base = (innerM ? innerM[1] : raw)
              .replace(/\[\]$/, '').replace(/^\*+/, '').replace(/^&(?:mut\s+)?/, '').trim();
            return classNameToFileId.get(base) || classNameToFileId.get(base.toLowerCase());
          })
          .filter((id): id is string => !!id && id !== fileId),
      );

      const allCalls = new Set(cls.methods.flatMap(m => m.calls));
      for (const call of allCalls) {
        // Prefer a target that is a known injected dependency of this class
        let targetClassId = findClassByMethodAmong(parsedFiles, call, injectedTargetIds);
        // Fall back to any class in the project with that method
        if (!targetClassId) {
          targetClassId = findClassByMethod(parsedFiles, call, pf.relPath);
        }
        if (targetClassId && targetClassId !== classId) {
          edges.push({ source: classId, target: targetClassId, type: 'calls', label: call });
        }
      }
    }
    // Top-level functions (non-class files)
    if (pf.classes.length === 0) {
      const allCalls = new Set(pf.functions.flatMap(f => f.calls));
      for (const call of allCalls) {
        const targetClassId = findClassByMethod(parsedFiles, call, pf.relPath);
        if (targetClassId) {
          edges.push({ source: fileId, target: targetClassId, type: 'calls', label: call });
        }
      }
    }
  }

  return { nodes, edges, parsedFiles, languages };
}

function findClassId(parsedFiles: ParsedFile[], className: string): string | undefined {
  for (const pf of parsedFiles) {
    const cls = pf.classes.find(c => c.name === className);
    if (cls) { return `class:${pf.relPath}:${cls.name}`; }
  }
  return undefined;
}

function findClassByMethod(parsedFiles: ParsedFile[], methodName: string, excludeFile: string): string | undefined {
  for (const pf of parsedFiles) {
    if (pf.relPath === excludeFile) { continue; }
    for (const cls of pf.classes) {
      if (cls.methods.some(m => m.name === methodName)) {
        return `class:${pf.relPath}:${cls.name}`;
      }
    }
  }
  return undefined;
}

/** Like findClassByMethod but restricts the search to a known set of class IDs (injected deps). */
function findClassByMethodAmong(
  parsedFiles: ParsedFile[],
  methodName: string,
  candidateIds: Set<string>,
): string | undefined {
  if (candidateIds.size === 0) { return undefined; }
  for (const pf of parsedFiles) {
    for (const cls of pf.classes) {
      const id = `class:${pf.relPath}:${cls.name}`;
      if (candidateIds.has(id) && cls.methods.some(m => m.name === methodName)) {
        return id;
      }
    }
  }
  return undefined;
}

function resolveImport(fromFile: string, imp: string, fileMap: Map<string, ParsedFile>): string | undefined {
  // Relative import
  if (imp.startsWith('.')) {
    const resolved = path.normalize(path.join(path.dirname(fromFile), imp)).replace(/\\/g, '/');
    // Try exact, then with common extensions
    for (const candidate of [resolved, `${resolved}/index`]) {
      if (fileMap.has(candidate)) { return fileMap.get(candidate)!.relPath; }
    }
  }
  return undefined;
}

// ═══════════════════════════════════════════════════════════════════════════════
// KB GRAPH (parse knowledge-base markdown)
// ═══════════════════════════════════════════════════════════════════════════════

function buildKBGraph(kbDir: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  if (!fs.existsSync(kbDir)) { return { nodes, edges }; }

  let mdFiles: string[];
  try { mdFiles = fs.readdirSync(kbDir).filter(f => f.endsWith('.md') && !f.startsWith('_')); }
  catch { return { nodes, edges }; }

  for (const file of mdFiles) {
    const content = readSafe(path.join(kbDir, file));
    if (!content || content.length < 50) { continue; }

    const parentId = `kb:${file.replace('.md', '')}`;
    const label = file.replace(/^\d+-/, '').replace('.md', '').replace(/-/g, ' ');

    nodes.push({
      id: parentId,
      label,
      type: 'kb-topic',
      layer: 'domain',
      description: extractFirstParagraph(content),
      file: `knowledge-base/${file}`,
      size: 4,
      details: content.slice(0, 800),
    });

    // Extract H2/H3 sections as child nodes
    const headings = content.match(/^#{2,3}\s+.+/gm) ?? [];
    const childIds: string[] = [];
    for (const h of headings.slice(0, 12)) {
      const text = h.replace(/^#+\s+/, '').trim();
      if (text.length < 3) { continue; }
      const childId = `kb:${file.replace('.md', '')}-${slug(text)}`;
      nodes.push({
        id: childId,
        label: text.slice(0, 45),
        type: 'kb-section',
        layer: 'domain',
        description: text,
        file: `knowledge-base/${file}`,
        size: 2,
      });
      edges.push({ source: parentId, target: childId, type: 'defines' });
      childIds.push(childId);
    }

    // Sequential flow between sections
    for (let i = 0; i < childIds.length - 1; i++) {
      edges.push({ source: childIds[i], target: childIds[i + 1], type: 'flows-to' });
    }
  }

  // Cross-link KB files that reference each other
  for (const file of mdFiles) {
    const content = readSafe(path.join(kbDir, file));
    const srcId = `kb:${file.replace('.md', '')}`;
    for (const other of mdFiles) {
      if (other === file) { continue; }
      const otherName = other.replace('.md', '').replace(/^\d+-/, '');
      if (content.toLowerCase().includes(otherName.replace(/-/g, ' '))) {
        const targetId = `kb:${other.replace('.md', '')}`;
        edges.push({ source: srcId, target: targetId, type: 'relates-to', label: 'references' });
      }
    }
  }

  return { nodes, edges };
}

function extractFirstParagraph(md: string): string {
  for (const line of md.split('\n')) {
    const t = line.trim();
    if (t && !t.startsWith('#') && !t.startsWith('|') && !t.startsWith('-') && !t.startsWith('`') && !t.startsWith('>')) {
      return t.slice(0, 200);
    }
  }
  return '';
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

export type GraphMode = 'all' | 'files' | 'classes' | 'domain' | 'routes';

export function buildGraphData(
  rootDir: string,
  mode: GraphMode | 'all' = 'all',
): GraphData {
  const t0 = Date.now();

  const allNodes: GraphNode[] = [];
  const allEdges: GraphEdge[] = [];
  const seen = new Set<string>();

  const addUnique = (ns: GraphNode[], es: GraphEdge[]) => {
    for (const n of ns) {
      if (!seen.has(n.id)) { seen.add(n.id); allNodes.push(n); }
    }
    allEdges.push(...es);
  };

  // Static analysis
  const { nodes: srcNodes, edges: srcEdges, languages } = buildStaticGraph(rootDir);

  if (mode === 'all' || mode === 'files') {
    addUnique(
      srcNodes.filter(n => n.type === 'file' || n.type === 'route'),
      srcEdges.filter(e => e.type === 'imports' || e.type === 'calls'),
    );
  }
  if (mode === 'all' || mode === 'classes') {
    addUnique(
      srcNodes.filter(n => ['class', 'interface', 'entity', 'controller', 'service', 'repository', 'middleware'].includes(n.type)),
      srcEdges.filter(e => ['defines', 'extends', 'implements', 'calls', 'injects'].includes(e.type)),
    );
  }
  if (mode === 'all' || mode === 'routes') {
    addUnique(
      srcNodes.filter(n => n.type === 'route' || n.type === 'controller'),
      srcEdges.filter(e => e.source.startsWith('route:') || e.target.startsWith('route:')),
    );
  }
  if (mode === 'all' || mode === 'domain') {
    const kbDir = path.join(rootDir, 'knowledge-base');
    const { nodes: kbNodes, edges: kbEdges } = buildKBGraph(kbDir);
    addUnique(kbNodes, kbEdges);
  }

  // Deduplicate edges
  const edgeSeen = new Set<string>();
  const uniqueEdges = allEdges.filter(e => {
    const key = `${e.source}→${e.target}→${e.type}`;
    if (edgeSeen.has(key)) { return false; }
    edgeSeen.add(key); return true;
  });

  // Remove dangling edges
  const nodeIds = new Set(allNodes.map(n => n.id));
  const validEdges = uniqueEdges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));

  // Project name
  let projectName = path.basename(rootDir);
  try {
    const pkg = JSON.parse(readSafe(path.join(rootDir, 'package.json')));
    projectName = pkg.displayName || pkg.name || projectName;
  } catch { /* ignore */ }
  // pom.xml — Java/Maven projects
  if (projectName === path.basename(rootDir)) {
    const pom = readSafe(path.join(rootDir, 'pom.xml'));
    if (pom) {
      const nameEl = pom.match(/<name>([^<]+)<\/name>/);
      const artId  = pom.match(/<artifactId>([^<]+)<\/artifactId>/);
      projectName = nameEl?.[1]?.trim() || artId?.[1]?.trim() || projectName;
    }
  }
  // Cargo.toml — Rust
  if (projectName === path.basename(rootDir)) {
    const cargo = readSafe(path.join(rootDir, 'Cargo.toml'));
    const nameMatch = cargo.match(/^name\s*=\s*"([^"]+)"/m);
    if (nameMatch) { projectName = nameMatch[1]; }
  }
  // pyproject.toml — Python
  if (projectName === path.basename(rootDir)) {
    const pyproject = readSafe(path.join(rootDir, 'pyproject.toml'));
    const nameMatch = pyproject.match(/^name\s*=\s*"([^"]+)"/m);
    if (nameMatch) { projectName = nameMatch[1]; }
  }

  return {
    nodes: allNodes,
    edges: validEdges,
    layers: Object.entries(LAYER_CONFIG).map(([id, cfg]) => ({
      id: id as NodeLayer,
      label: cfg.label,
      color: cfg.color,
    })),
    metadata: {
      projectName,
      generatedAt: new Date().toISOString(),
      nodeCount: allNodes.length,
      edgeCount: validEdges.length,
      languages: Array.from(languages),
      scanDurationMs: Date.now() - t0,
    },
  };
}
