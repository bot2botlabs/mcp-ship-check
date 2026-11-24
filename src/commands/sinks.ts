import { readdir, readFile } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { message } from '../project.js';
import { finish, unavailable, type Result, type Level } from '../report.js';

export interface SinksOptions { strict?: boolean }

// node_modules/build output plus non-runtime trees (scripts, docs, examples,
// browser extensions, benchmarks) that are not the shipped MCP tool handlers.
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage', 'vendor', '__pycache__', '.git',
  'scripts', 'script', 'docs', 'doc', 'examples', 'example', 'extension', 'e2e',
  'benchmark', 'benchmarks', 'bench', 'fixtures', 'research', 'eval', 'evals', 'ingest', 'tooling',
]);
const JS = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts']);
const PY = new Set(['.py']);
const MAX_FILES = 4000;
const MAX_BYTES = 512 * 1024;
const BOUND = 4000;
const isTest = (p: string) => /(^|[\\/])tests?[\\/]|\.test\.|\.spec\.|(^|[\\/])test_[^\\/]*\.py$|_test\.py$/.test(p);

/**
 * Static "Safe Sinks" scan of a server's own source. Deterministic, offline,
 * never executes anything. It flags the SHAPE of a risky sink (an argument
 * flowing into process execution, the filesystem, or a SQL string in an unsafe
 * form) so a human can review it — a targeting aid, never a vulnerability
 * verdict. Default severity is `warn`; `--strict` promotes risky shapes to
 * `error`.
 *
 * v2 precision: `exec` only matches functions actually bound to child_process
 * (never RegExp `.exec`); `sql` requires a SQL *statement shape* with
 * interpolation (not a lone keyword or `.join(`); non-runtime trees are
 * skipped; `fs` flags only externally-derived paths (not homedir/env/const
 * config reads).
 *
 * v2.6: adds a 4th sink family, `transport` — flags an MCP HTTP server that
 * stands up `StreamableHTTPServerTransport` without `enableDnsRebindingProtection:
 * true`, or binds its listener to all interfaces (no host / callback-as-host /
 * `0.0.0.0`), or passes `host="0.0.0.0"` to `uvicorn.run`/`mcp.run` in Python.
 * Gated to files that actually construct an MCP HTTP transport, for near-zero
 * false positives.
 *
 * v2.8 (0.6.0), measured on 627 cloned servers before release:
 * (1) "The file authenticates callers" now needs evidence of a check on the
 * INCOMING request (reading the Authorization / x-api-key request header, an
 * SDK auth middleware, a 401 reply). A mention of "authorization" or "bearer"
 * no longer counts: most API-wrapper servers only send such a header upstream.
 * This tightens the wildcard-CORS rule shipped in 0.5.0, which missed servers
 * for that reason.
 * (2) With that evidence in the same file, a StreamableHTTPServerTransport
 * built without enableDnsRebindingProtection is a hardening note, not a risky
 * finding: a rebinding page cannot present the credential. Optional auth
 * (a token that is only checked when configured) is not detected; the note
 * says to confirm every route is behind the check.
 * (3) sql: a read-only SELECT whose interpolations are all table names
 * (after FROM/JOIN) or in the column list is a note, not a risky finding.
 * Interpolation in a value or predicate position, and any interpolation in a
 * statement that writes or changes schema, stays risky.
 *
 * v2.9 (0.7.0): a 5th family, `ssrf` — an outbound HTTP request whose URL is
 * taken from the tool call or request, with no allowlist or private-address
 * check in the file. Fixed-base URLs are not flagged.
 *
 * v2.7: (1) `exec` matching already excludes a member-access call (`db.exec(`,
 * `regex.exec(`) via a `(?<![.\w$])` lookbehind, so a child_process binding in
 * scope no longer turns a DuckDB/RegExp `.exec` into a finding; the namespace
 * form (`cp.exec(`) is still flagged by its own matcher. (2) the Python
 * `transport` check now also inspects `FastMCP(host=...)` and recognises a host
 * bound to `0.0.0.0`/`::` via an `os.getenv(..., "0.0.0.0")` default fallback,
 * not just a direct literal.
 */
export async function sinks(dir = '.', options: SinksOptions = {}) {
  try {
    const strict = !!options.strict;
    const sources = await collect(dir);
    const results: Result[] = [];
    let risky = 0, safe = 0, scanned = 0;
    // Express apps usually mount the MCP SDK's Host-validation middleware in one
    // file and construct the transport in another, so look for it project-wide.
    let sdkHostGuard = false;
    let projectMcpHttp = false;
    // Modules imported by a file that defines a tool handler: one hop of
    // reachability, so a helper such as ./search-content.ts that a tool file
    // calls is still treated as tool-reachable by the fs rule.
    const toolImports = new Set<string>();
    const stem = (p: string) => (p.split(/[\\/]/).pop() ?? '').replace(/\.(?:[cm]?[jt]sx?|py)$/, '');
    for (const f of sources) {
      const raw = await readFile(f.path, 'utf8').catch(() => null);
      if (raw === null || raw.length > MAX_BYTES) continue;
      const code = stripComments(raw, f.py);
      if (!f.py && SDK_HOST_GUARD.test(code)) sdkHostGuard = true;
      if (!f.py && MCP_HTTP_TRANSPORT.test(code)) projectMcpHttp = true;
      if (!(f.py ? TOOL_FILE_PY : TOOL_FILE_JS).test(code)) continue;
      const re = f.py ? /^\s*(?:from\s+([\w.]+)\s+import\s+([\w, ]+)|import\s+([\w.]+))/gm : /(?:from\s+|require\s*\(\s*|import\s*\(\s*)['"`](\.{1,2}\/[^'"`]+)['"`]/g;
      for (const m of code.matchAll(re)) {
        if (!f.py) { toolImports.add(stem(m[1])); continue; }
        const mod = (m[1] ?? m[3] ?? '').split('.').filter(Boolean).pop(); if (mod) toolImports.add(mod);
        if (m[1] && /^\.+$/.test(m[1]) && m[2]) for (const n of m[2].split(',')) toolImports.add(n.trim());
      }
    }
    for (const f of sources) {
      const raw = await readFile(f.path, 'utf8').catch(() => null);
      if (raw === null || raw.length > MAX_BYTES) continue;
      scanned++;
      const code = stripComments(raw, f.py);
      for (const h of scanFile(code, f.py, f.rel, strict, sdkHostGuard, projectMcpHttp, toolImports.has(stem(f.rel)))) {
        if (h.level === 'error' || h.level === 'warn') risky++; else if (h.level === 'ok') safe++;
        results.push(h);
      }
    }
    if (scanned === 0) { results.push({ id: 'sinks', level: 'skip', message: 'no runtime JS/TS or Python source found to scan (hosted relay, compiled-only, or non-runtime only?)' }); return finish('sinks', results); }
    results.unshift({
      id: 'sinks',
      level: risky ? (strict ? 'error' : 'warn') : 'ok',
      message: `${scanned} source file(s); ${risky} risky sink shape(s), ${safe} safe sink(s)` + (risky ? (strict ? ' — --strict: risky = error' : ' — review; a shape is not a vulnerability finding') : ''),
    });
    return finish('sinks', results);
  } catch (e) { return unavailable('sinks', message(e)); }
}

// ── file discovery ──────────────────────────────────────────────────────────
export async function collect(dir: string) {
  const out: { path: string; rel: string; py: boolean }[] = [];
  async function walk(d: string): Promise<void> {
    if (out.length >= MAX_FILES) return;
    let entries;
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) await walk(full); continue; }
      if (!e.isFile()) continue;
      const rel = relative(dir, full);
      if (isTest(rel)) continue;
      const ext = extname(e.name);
      if (JS.has(ext)) out.push({ path: full, rel, py: false });
      else if (PY.has(ext)) out.push({ path: full, rel, py: true });
    }
  }
  await walk(dir);
  return out;
}

// ── comment stripping (keeps string literals and newlines; drops comments and
//    Python statement-position docstrings so commented-out code can't trigger) ─
export function stripComments(src: string, py: boolean): string {
  const out: string[] = [];
  let i = 0; const n = src.length; let prevNonSpace = '\n';
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (!py && c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') { out.push(' '); i++; } continue; }
    if (!py && c === '/' && c2 === '*') { out.push('  '); i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out.push(src[i] === '\n' ? '\n' : ' '); i++; } if (i < n) { out.push('  '); i += 2; } continue; }
    if (py && c === '#') { while (i < n && src[i] !== '\n') { out.push(' '); i++; } continue; }
    if (c === '"' || c === "'") {
      const triple = src[i + 1] === c && src[i + 2] === c;
      if (py && triple && (prevNonSpace === '\n' || prevNonSpace === ':')) {
        out.push('   '); i += 3;
        while (i < n && !(src[i] === c && src[i + 1] === c && src[i + 2] === c)) { out.push(src[i] === '\n' ? '\n' : ' '); i++; }
        if (i < n) { out.push('   '); i += 3; }
        prevNonSpace = ' '; continue;
      }
      out.push(c); i++;
      if (triple) { out.push(c + c); i += 2; }
      while (i < n) {
        if (src[i] === '\\') { out.push(src[i]); if (i + 1 < n) out.push(src[i + 1]); i += 2; continue; }
        if (triple) { if (src[i] === c && src[i + 1] === c && src[i + 2] === c) { out.push(c + c + c); i += 3; break; } out.push(src[i]); i++; continue; }
        if (src[i] === c) { out.push(c); i++; break; }
        out.push(src[i]); i++;
      }
      prevNonSpace = c; continue;
    }
    if (!py && c === '`') {
      out.push('`'); i++;
      while (i < n) {
        if (src[i] === '\\') { out.push(src[i]); if (i + 1 < n) out.push(src[i + 1]); i += 2; continue; }
        if (src[i] === '`') { out.push('`'); i++; break; }
        out.push(src[i]); i++;
      }
      prevNonSpace = '`'; continue;
    }
    out.push(c);
    if (!/\s/.test(c)) prevNonSpace = c;
    i++;
  }
  return out.join('');
}

// ── helpers ─────────────────────────────────────────────────────────────────
function lineIndexer(code: string) {
  const nl: number[] = [];
  for (let i = 0; i < code.length; i++) if (code[i] === '\n') nl.push(i);
  return (idx: number) => { let lo = 0, hi = nl.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (nl[mid] < idx) lo = mid + 1; else hi = mid; } return lo + 1; };
}

function callArg(code: string, openIdx: number): string {
  let depth = 0; const cap = Math.min(code.length, openIdx + 800); let i = openIdx;
  for (; i < cap; i++) { const c = code[i]; if (c === '(') depth++; else if (c === ')') { depth--; if (depth === 0) return code.slice(openIdx + 1, i); } }
  return code.slice(openIdx + 1, cap);
}

// The first top-level argument of a call, so a static command isn't judged
// dynamic because a later options argument (e.g. `{ input: a + b }`) contains
// a `+`. Skips string literals and nested brackets.
function firstArg(args: string): string {
  let depth = 0;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < args.length && args[i] !== q) { if (args[i] === '\\') i++; i++; }
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) return args.slice(0, i);
  }
  return args;
}

// Split a call's argument string into top-level args (commas inside strings,
// parens, brackets and braces do not split). Used by the transport detector to
// read a listener's second positional argument (the bind host).
function argList(args: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < args.length && args[i] !== q) { if (args[i] === '\\') i++; i++; }
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) { out.push(args.slice(start, i).trim()); start = i + 1; }
  }
  out.push(args.slice(start).trim());
  return out;
}

function unwrapPurePath(expr: string): string | null {
  const m = /^(?:pathlib\s*\.\s*)?(?:Pure)?Path\s*\(/.exec(expr);
  if (!m) return null;
  const open = m[0].length - 1;
  const inner = callArg(expr, open);
  return open + inner.length + 2 === expr.length ? inner.trim() : null;
}

// The receiver of a method call, for sinks whose path is the object rather than
// an argument: `Path(f"public/{name}").write_text(data)` writes to the Path,
// not to `data`. Walks back over a member/call chain from the `.` before the
// method name. A standalone `Path(...)` / `PurePath(...)` wrapper is unwrapped
// when all its arguments are literals (so `Path("a", "b")` stays literal while
// `Path("public", filename)` stays dynamic).
function receiverExpr(code: string, dot: number): string {
  const stop = Math.max(0, dot - 400);
  let j = dot - 1;
  for (;;) {
    while (j >= stop && /\s/.test(code[j])) j--;
    if (j < stop) break;
    const c = code[j];
    if (c === ')' || c === ']') {
      let depth = 0;
      for (; j >= stop; j--) { const d = code[j]; if (d === ')' || d === ']') depth++; else if ((d === '(' || d === '[') && --depth === 0) break; }
      j--;
      while (j >= stop && /[\w$]/.test(code[j])) j--;
    } else if (/[\w$]/.test(c)) {
      while (j >= stop && /[\w$]/.test(code[j])) j--;
    } else if (c === '"' || c === "'") {
      j--; while (j >= stop && code[j] !== c) j--; j--;
      while (j >= stop && /[rfbu]/i.test(code[j])) j--;
    } else break;
    let k = j; while (k >= stop && /\s/.test(code[k])) k--;
    if (k >= stop && code[k] === '.') { j = k - 1; continue; }
    break;
  }
  const recv = code.slice(j + 1, dot).trim();
  const inner = unwrapPurePath(recv);
  if (inner !== null && argList(inner).every((p) => !argIsDynamic(p, true))) return inner;
  return recv;
}

function splitTopLevelSlash(expr: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < expr.length && expr[i] !== q) { if (expr[i] === '\\') i++; i++; }
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === '/' && depth === 0) { out.push(expr.slice(start, i).trim()); start = i + 1; }
  }
  out.push(expr.slice(start).trim());
  return out;
}

function argIsDynamic(arg: string, py: boolean): boolean {
  const a = arg.trim();
  if (/\$\{/.test(a)) return true;
  if (/\+/.test(a)) return true;
  if (py && /\bf['"]/.test(a)) return true;
  if (py && (/%\s*[(\w"']/.test(a) || /\.format\s*\(/.test(a))) return true;
  if (py && a.startsWith('(') && a.endsWith(')') && callArg(a, 0).length + 2 === a.length) {
    const inner = a.slice(1, -1).trim();
    const parts = splitTopLevelSlash(inner);
    if (parts.length > 1) {
      return parts.some((part) => {
        const unwrapped = unwrapPurePath(part);
        return unwrapped !== null ? argList(unwrapped).some((p) => argIsDynamic(p, true)) : argIsDynamic(part, true);
      });
    }
    return argIsDynamic(inner, true);
  }
  if (/^[A-Za-z_$]/.test(a)) return true;
  return false;
}

const EXEC_FUNCS = new Set(['exec', 'execSync', 'spawn', 'spawnSync', 'fork', 'execFile', 'execFileSync']);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Which local names in this JS/TS file are bound to child_process (so `exec`
// means the shell call, not RegExp.prototype.exec or any other `.exec`).
function jsCpBindings(code: string): { ns: Set<string>; fns: Map<string, string> } {
  const ns = new Set<string>(); const fns = new Map<string, string>();
  const clause = (c: string) => {
    c = c.trim();
    // Extract the named-imports block first so its inner commas aren't split on.
    const brace = /\{([\s\S]*?)\}/.exec(c);
    if (brace) { inner(brace[1]); c = c.slice(0, brace.index) + c.slice(brace.index + brace[0].length); }
    for (let part of c.split(',')) {
      part = part.trim(); if (!part) continue;
      let m;
      if ((m = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/.exec(part))) { ns.add(m[1]); continue; }
      if ((m = /^([A-Za-z_$][\w$]*)$/.exec(part))) ns.add(m[1]); // default/namespace import
    }
  };
  const inner = (c: string) => {
    for (let part of c.split(',')) {
      part = part.trim(); if (!part) continue;
      const m = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(part);
      if (m && EXEC_FUNCS.has(m[1])) fns.set(m[2] || m[1], m[1]);
    }
  };
  // Each static import is matched on its own: [^;'"] cannot cross a previous
  // import's source string, so child_process need not be the first import in
  // the file (the earlier [\s\S]+? spanned statements and read the wrong one).
  for (const m of code.matchAll(/import\s+([^;'"]+?)\s+from\s*['"](?:node:)?child_process['"]/g)) clause(m[1]);
  // CJS require() and dynamic import() assigned to a binding, e.g.
  // `const cp = await import('node:child_process')` or `const { exec } = require('child_process')`.
  for (const m of code.matchAll(/(?:const|let|var)\s+(\{[\s\S]*?\}|[A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:require|import)\(\s*['"](?:node:)?child_process['"]\s*\)/g)) {
    const b = m[1].trim();
    if (b.startsWith('{')) inner(b.slice(1, -1)); else ns.add(b);
  }
  // Inline destructured dynamic import: `(await import('child_process')).exec(...)`
  // or `import('child_process').then(({ exec }) => ...)`.
  for (const m of code.matchAll(/import\(\s*['"](?:node:)?child_process['"]\s*\)\s*\)?\s*(?:\.then\s*\(\s*)?(?:\(\s*)?(\{[^}]*\})/g)) inner(m[1].slice(1, -1));

  // Thin-wrapper aliases: a local bound to a cp shell-exec via `promisify(exec)`
  // or a wrapper function/arrow whose body calls exec/execSync. Catches
  // `const execAsync = promisify(exec)` and `function execPromise(cmd){ ...exec(cmd)... }`
  // (then `execAsync(`...`)` / `execPromise(cmd)` are treated as exec). Iterate
  // so a wrapper around a wrapper is also resolved.
  const shellAlts = (): string | null => {
    const alts = [
      ...[...fns].filter(([, r]) => r === 'exec' || r === 'execSync').map(([l]) => esc(l)),
      ...[...ns].map((nm) => esc(nm) + '\\s*\\.\\s*(?:exec|execSync)'),
    ];
    return alts.length ? alts.join('|') : null;
  };
  const firstParam = (sig: string): string | null => { const m = /^\(?\s*(?:\.\.\.)?\s*([A-Za-z_$][\w$]*)/.exec(sig.trim()); return m ? m[1] : null; };
  for (let pass = 0; pass < 3; pass++) {
    const alts = shellAlts();
    if (!alts) break;
    let added = false;
    // const X = promisify(exec)
    for (const m of code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:[\w$]+\.)?promisify\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
      const real = fns.get(m[2]);
      if (!fns.has(m[1]) && (real === 'exec' || real === 'execSync')) { fns.set(m[1], real); added = true; }
    }
    // thin wrapper that passes its first parameter straight into exec/execSync
    for (const re of [/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g, /function\s+([A-Za-z_$][\w$]*)\s*(\([^)]*\))/g]) {
      for (const m of code.matchAll(re)) {
        if (fns.has(m[1])) continue;
        const param = firstParam(m[2]); if (!param) continue;
        const body = code.slice(m.index ?? 0, (m.index ?? 0) + 400);
        if (new RegExp('(?<![.\\w$])(?:' + alts + ')\\s*\\(\\s*' + esc(param) + '\\b').test(body)) { fns.set(m[1], 'exec'); added = true; }
      }
    }
    if (!added) break;
  }
  return { ns, fns };
}

// A SQL statement shape (two-token anchored), not a lone keyword. Shapes are
// tested on string bodies whose interpolations were replaced by the identifier
// token INTERP (see `sqlShape`), so code inside `${...}` / `{...}` never counts
// as SQL text while `FROM ${t}` still reads as `FROM <identifier>`.
// SELECT ... FROM allows up to 1000 characters between the keywords (long column
// lists and CASE blocks) but no sentence break (". "), which SQL between those
// keywords practically never contains and prose nearly always does. v0.3.2 tightens three shapes that matched ordinary prose and status strings:
//   UPDATE ... SET  — UPDATE can't be followed directly by SET ("update set" is
//                     a common product term) except in ON CONFLICT ... DO UPDATE SET,
//                     and SET must start an assignment;
//   DROP INDEX/...  — needs a name and then a statement boundary, so
//                     "drop index suggestions: ..." is prose;
//   TRUNCATE        — needs TABLE, or an uppercase TRUNCATE followed by a name
//                     (not "TRUNCATE)" in a list of DDL verbs, not truncate(...)).
const INTERP = '__ms_interp__';
const IDENT = '[\\w.$"`\\[\\]]+';
const STMT = '(?:SELECT\\b(?:(?!\\.\\s)[\\s\\S]){0,1000}?\\bFROM\\b|INSERT\\s+INTO\\b'
  + '|UPDATE\\s+(?!SET\\b)[\\s\\S]{0,120}?\\bSET\\s+(?:' + IDENT + '\\s*=|' + INTERP + '|\\()'
  + '|DO\\s+UPDATE\\s+SET\\s+(?:' + IDENT + '\\s*=|' + INTERP + '|\\()'
  + '|DELETE\\s+FROM\\b|CREATE\\s+(?:TABLE|INDEX|VIEW|TRIGGER)\\b'
  + '|DROP\\s+(?:TABLE|INDEX|VIEW)\\s+(?:IF\\s+EXISTS\\s+)?(?:CONCURRENTLY\\s+)?' + IDENT + '(?=\\s*(?:$|[;,)\\n\'"`]|ON\\b|CASCADE\\b|RESTRICT\\b))'
  + '|ALTER\\s+TABLE\\b|TRUNCATE\\s+TABLE\\b|REPLACE\\s+INTO\\b)';
const STMT_RE = new RegExp(STMT, 'i');
// Lone `TRUNCATE <name>` (no TABLE keyword) only counts in uppercase: in
// lowercase it is far more often the English word or a truncate() helper.
const TRUNCATE_RE = /\bTRUNCATE\s+(?:ONLY\s+)?(?!TABLE\b)[A-Za-z_"`\[][\w.$"`\]]*(?=\s*(?:$|[;,)\n]|CASCADE\b|RESTART\b|CONTINUE\b))/;
const isSqlShape = (body: string): boolean => STMT_RE.test(body) || TRUNCATE_RE.test(body);

/** The string body with each interpolation replaced by INTERP (an identifier-shaped token). */
function sqlShape(s: { body: string; template: boolean; fstring: boolean }): string {
  if (s.template) return s.body.replace(/\$\{[^}]*\}/g, INTERP);
  if (s.fstring) return s.body.replace(/\{\{|\}\}/g, '').replace(/\{[^{}]*\}/g, INTERP);
  return s.body;
}

interface Str { start: number; end: number; body: string; template: boolean; fstring: boolean; interp: boolean }
// Single linear pass (no backtracking) collecting string-literal spans and
// whether each interpolates. Runs on comment-stripped code, so delimiters are
// intact and comments are gone.
// A `/` starts a regex literal (rather than division) only in a value-expected
// position: at the start, or after an operator / punctuation, not after an
// identifier, number, `)`, `]` or `.`.
function regexAllowed(prev: string): boolean {
  return prev === '' || !/[A-Za-z0-9_$)\].]/.test(prev);
}

function collectStrings(code: string, py: boolean): Str[] {
  const out: Str[] = []; const n = code.length; let i = 0; let prev = '';
  while (i < n) {
    const c = code[i];
    // JS regex literal: skip it so a quote inside `/..."../` is not seen as a
    // string delimiter (which would mislabel the rest of the file).
    if (!py && c === '/' && code[i + 1] !== '/' && code[i + 1] !== '*' && regexAllowed(prev)) {
      i++; let inClass = false; let ok = false;
      for (; i < n; i++) {
        const d = code[i];
        if (d === '\\') { i++; continue; }
        if (d === '\n') break;                       // a regex cannot span lines
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) { i++; ok = true; break; }
      }
      if (ok) while (i < n && /[a-z]/i.test(code[i])) i++;  // flags
      prev = 'x';                                     // a regex result is a value
      continue;
    }
    if (!py && c === '`') {
      const start = i; let interp = false; i++;
      for (; i < n; i++) { if (code[i] === '\\') { i++; continue; } if (code[i] === '$' && code[i + 1] === '{') interp = true; if (code[i] === '`') break; }
      out.push({ start, end: i + 1, body: code.slice(start + 1, i), template: true, fstring: false, interp }); i++;
      prev = 'x'; continue;
    }
    if (c === '"' || c === "'") {
      const start = i; const p1 = code[i - 1] || '', p2 = code[i - 2] || '';
      const fstring = py && (/[fF]/.test(p1) || (/[rRbB]/.test(p1) && /[fF]/.test(p2)));
      const triple = (code[i + 1] === c && code[i + 2] === c);
      let interp = false; let closed = false; i += triple ? 3 : 1;
      for (; i < n; i++) {
        if (code[i] === '\\') { i++; continue; }
        if (fstring && code[i] === '{' && code[i + 1] !== '{') interp = true;
        if (triple) { if (code[i] === c && code[i + 1] === c && code[i + 2] === c) { closed = true; break; } }
        else { if (code[i] === c) { closed = true; break; } if (code[i] === '\n') break; } // '/" cannot span a raw newline
      }
      const end = triple ? (closed ? i + 3 : i) : (closed ? i + 1 : i);
      out.push({ start, end, body: code.slice(start, end), template: false, fstring, interp });
      i = end; prev = 'x'; continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

// The MCP TypeScript SDK's own DNS-rebinding defenses for Express apps.
// A file that defines a tool or HTTP request handler.
const TOOL_FILE_PY = /@[\w.]*tool\b|FastMCP|call_tool|list_tools|@(?:app|router)\.(?:get|post|put|delete|route)\b/;
const TOOL_FILE_JS = /\b(?:registerTool|setRequestHandler)\s*\(|\.tool\s*\(|\bz\s*\.\s*(?:string|object)\s*\(|\b(?:app|router)\s*\.\s*(?:get|post|put|delete|all|use)\s*\(|CallToolRequestSchema/;
const SDK_HOST_GUARD = /\b(?:localhostHostValidation|hostHeaderValidation|createMcpExpressApp)\s*\(/;

const MCP_HTTP_TRANSPORT = /StreamableHTTPServerTransport|SSEServerTransport/;
// CORS settings that let every website read the server's replies.
const CORS_ANY = /\bregister\s*\(\s*(?:cors|fastifyCors)\s*(?:\)|,\s*\{[^}]{0,400}?\borigin\s*:\s*(?:['"`]\*['"`]|true\b))|\bcors\s*\(\s*\)|\bcors\s*\(\s*\{[^}]{0,400}?\borigin\s*:\s*(?:['"`]\*['"`]|true\b)|Access-Control-Allow-Origin['"`]\s*,\s*['"`]\*['"`]/g;
// Any sign that the file authenticates callers. Comments are already stripped,
// so middleware that is commented out does not count.
// Evidence that the file checks credentials on INCOMING requests. Sending an
// Authorization header to an upstream API (which most API-wrapper servers do)
// is not authentication of the caller, so a bare mention of "authorization",
// "bearer" or "apiKey" does not count.
const AUTH_IN_FILE = /\breq(?:uest)?\s*\.\s*(?:headers\s*(?:\.\s*authorization\b|\[\s*['"`](?:authorization|x-api-key)['"`]\s*\])|(?:header|get)\s*\(\s*['"`](?:authorization|x-api-key)['"`]\s*\))|\bheaders\s*\[\s*['"`](?:authorization|x-api-key)['"`]\s*\](?!\s*=[^=])|\b(?:requireBearerAuth|mcpAuthRouter|basicAuth|bearerAuth)\s*\(|WWW-Authenticate|\bauthInfo\b|\b(?:verify|validate|check|require)\w*(?:Auth|Token|ApiKey|Bearer|Jwt|JWT)\w*\s*\(|\bstatus\s*\(\s*401\s*\)|\bwriteHead\s*\(\s*401\b|\bstatusCode\s*=\s*401\b|\bsendStatus\s*\(\s*401\s*\)|\b(?:app|router|server|api|mcpRouter)\s*\.\s*(?:use|all|get|post|put|patch|delete)\s*\([^)]*\b(?:authenticate\w*|ensureAuth\w*|ensureLoggedIn|isAuthenticated|requireAuth\w*|requiresAuth|requireLogin|requireUser|authMiddleware|authGuard|checkJwt|withAuth)\b|\b(?:passport\s*\.\s*authenticate|express[-_]?jwt|expressJwt|jwtVerify|clerkMiddleware|withApiAuth)\s*\(/i;
// Auth that only runs when a credential is configured: `if (!token) return next()`,
// `if (config.auth?.enabled) app.use(...)`, `if not API_KEY: return True`. Such a
// server starts open, so the check is not counted as authentication.
const OPTIONAL_AUTH = /\bif\s*\(\s*!\s*[\w.?$]*(?:token|secret|api_?key|password|passphrase|credential|bearer)\w*\s*\)\s*(?:\{[^{}]{0,240}?)?(?:return\s+(?:(?:await\s+)?next\s*\(\s*\)|true\b)|(?:await\s+)?next\s*\(\s*\))|\bif\s*\(\s*[\w.?$]*(?:auth\w*\s*\??\.\s*enabled|authEnabled|enableAuth\w*|requireAuth|useAuth|auth_enabled)\s*\)|\bif\s+not\s+[\w.]*(?:token|secret|api_?key|password)\w*\s*:\s*(?:\n\s*)?(?:return\s+(?:True|None|await\s+call_next)|pass\b)/i;
const authenticates = (code: string): boolean => AUTH_IN_FILE.test(code) && !OPTIONAL_AUTH.test(code);
// "Is this client local?" asked with a substring test.
const SUBSTR_LOOPBACK_JS = /\b\w*(?:ip|Ip|IP|addr|Addr|address|Address|remote|Remote)\w*\s*(?:\?\.|\.)\s*includes\(\s*['"`]::1['"`]\s*\)/g;
const SUBSTR_LOOPBACK_PY = /['"]::1['"]\s+in\s+\w*(?:ip|addr|address|remote|client_host|peer)\w*\b(?!\s*\()/g;

function scanFile(code: string, py: boolean, rel: string, strict: boolean, sdkHostGuard = false, projectMcpHttp = false, toolImported = false): Result[] {
  const out: Result[] = [];
  const lineAt = lineIndexer(code);
  const risky: Level = strict ? 'error' : 'warn';
  const add = (id: string, level: Level, idx: number, msg: string) => out.push({ id, level, message: `${rel}:${lineAt(idx)} — ${msg}` });

  // String-literal spans: an exec/fs "call" that falls inside a string literal
  // (e.g. the token "os.system(" in a linter's rule list) is not a real call.
  const strs = collectStrings(code, py);
  const inStr = (i: number) => strs.some((s) => i >= s.start && i < s.end);

  // ---- process execution ----
  // The shape that turned out to be a real injection most often: a command string that
  // splices a non-constant value in (`git blame "${filePath}"`, f"... {name}"). Double
  // quotes around the value do not stop $(...), backticks or a closing quote. The finding
  // names the value so these can be read first.
  const splicedValue = (arg: string): string => {
    const first = firstArg(arg).trim();
    const exprs = /^`/.test(first) ? [...first.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1].trim())
      : /^[rb]*f[rb]*['"]/i.test(first) ? [...first.replace(/\{\{|\}\}/g, '').matchAll(/\{([^{}]*)\}/g)].map((m) => m[1].trim())
      : [];
    const live = exprs.find((e) => e && !/^[A-Z][A-Z0-9_]*(?:\.[A-Z0-9_]+)*$/.test(e) && !/^(?:process\.(?:pid|platform|execPath)|pid|port|PORT)$/.test(e));
    return live ? ` — splices \`${live.slice(0, 40)}\` into the command text, and quoting it does not stop $(...) or a closing quote` : '';
  };
  if (!py) {
    const { ns, fns } = jsCpBindings(code);
    const classify = (real: string, idx: number, how: string) => {
      if (inStr(idx)) return;
      const arg = callArg(code, code.indexOf('(', idx));
      if (real === 'exec' || real === 'execSync') {
        if (argIsDynamic(firstArg(arg), py)) add('exec', risky, idx, `child_process.${real} (${how}) runs a shell with a variable/interpolated command — use execFile([...]) with an argument array${splicedValue(arg)}`);
        else add('exec', 'ok', idx, `child_process.${real} with a static literal command`);
      } else if (real === 'spawn' || real === 'spawnSync' || real === 'fork') {
        if (/\bshell\s*:\s*true\b/.test(arg)) add('exec', risky, idx, `${real} with { shell: true } runs a shell — drop shell:true and pass an argument array`);
        else add('exec', 'ok', idx, `${real} without shell:true (argument-array form)`);
      } else add('exec', 'ok', idx, `${real} uses an argument array (no shell)`);
    };
    for (const [local, real] of fns) for (const m of code.matchAll(new RegExp('(?<![.\\w$])' + esc(local) + '\\s*\\(', 'g'))) classify(real, m.index ?? 0, 'imported');
    for (const name of ns) for (const m of code.matchAll(new RegExp('\\b' + esc(name) + '\\s*\\.\\s*(' + [...EXEC_FUNCS].join('|') + ')\\s*\\(', 'g'))) classify(m[1], m.index ?? 0, `${name}.${m[1]}`);
  } else {
    for (const m of code.matchAll(/\bsubprocess\.(run|call|check_output|check_call|Popen)\s*\(/g)) {
      const idx = m.index ?? 0; if (inStr(idx)) continue;
      const arg = callArg(code, idx + m[0].length - 1);
      if (/\bshell\s*=\s*True\b/.test(arg)) add('exec', risky, idx, `subprocess.${m[1]}(..., shell=True) runs a shell — use a list argument with shell=False${splicedValue(arg)}`);
      else add('exec', 'ok', idx, `subprocess.${m[1]} without shell=True`);
    }
    for (const m of code.matchAll(/\bos\.(system|popen)\s*\(/g)) { if (!inStr(m.index ?? 0)) add('exec', risky, m.index ?? 0, `os.${m[1]} runs a shell — use subprocess.run([...], shell=False)`); }
    for (const m of code.matchAll(/\bcommands\.getoutput\s*\(/g)) { if (!inStr(m.index ?? 0)) add('exec', risky, m.index ?? 0, 'commands.getoutput runs a shell — use subprocess.run([...], shell=False)'); }
  }

  // ---- filesystem bounds (file-scoped guard; external-path-only flag) ----
  const guarded = py
    ? /os\.path\.realpath|realpath\s*\(|\.resolve\s*\(\)/.test(code) && /startswith|commonpath|relpath|['"]\.\.['"]/.test(code)
    : /path\.resolve|path\.normalize|realpath|\bresolve\s*\(|\bnormalize\s*\(/.test(code) && /startsWith|path\.relative|\brelative\s*\(|['"]\.\.['"]/.test(code);
  const SYS_ROOT = /homedir|tmpdir|__dirname|import\.meta|process\.env|os\.getcwd|Path\.home|\bcwd\b|realpath|dirname\s*\(/i;
  const fsPat = py
    ? /(?<![.\w])(open|aiofiles\.open|os\.open|os\.remove|os\.unlink|os\.rename|shutil\.(?:copy|copyfile|move|rmtree))\s*\(|\.(?:read_text|write_text|read_bytes|write_bytes)\s*\(/g
    : /\b(?:fs(?:\.promises)?\.)?(?:readFile|readFileSync|writeFile|writeFileSync|appendFile|appendFileSync|createReadStream|createWriteStream|unlinkSync|readdirSync)\s*\(|\bfs(?:\.promises)?\.(?:open|openSync|unlink|rm|rmSync|readdir|copyFile|rename|renameSync|stat|statSync)\s*\(/g;
  // Only flag when the path plausibly comes from a tool/request argument; an
  // internal variable path (app state/working files) is low-value here and
  // local-only, so it is reported ok rather than warned on.
  const INPUT = /\breq\b|\brequest\b|\bparams?\b|\bquery\b|\bbody\b|\bpayload\b|\binput\b|\bargs?\b|\barguments\b|\buser[_A-Za-z0-9]*\b|\bupload\b|\bfilename\b|\bfilepath\b|file_path|\bdestination\b|\bdest\b|\btarget\b|output_?path/i;
  // A path-like variable name (filePath, target, dest) is only evidence of tool
  // input where tool input exists: the argument reads the tool-argument object
  // directly, or the file itself registers a tool / request handler. In library,
  // CLI and state-keeping files the same names are internal paths. Member paths
  // on `this` or an UPPER_CASE constant are internal everywhere.
  const fsToolFile = toolImported || (py ? TOOL_FILE_PY : TOOL_FILE_JS).test(code);
  const FS_DIRECT = /\b(?:args|arguments|params|kwargs|payload|input|inputs)\s*(?:\?\.|\.|\[)|\breq(?:uest)?\s*\.\s*(?:body|query|params|files?)\b/;
  // Names that say the value came from outside (userPath, uploadName, req, args) count anywhere.
  const FS_UNTRUSTED_NAME = /\breq\b|\brequest\b|\bparams?\b|\bquery\b|\bbody\b|\bpayload\b|\binputs?\b|\bargs?\b|\barguments\b|\buser[_A-Za-z0-9]*\b|\bupload\w*\b|\buntrusted\w*\b/i;
  const fsToolReach = (arg: string): boolean => {
    const first = firstArg(arg).trim();
    if (/^(?:this\s*\.|self\s*\.|[A-Z][A-Z0-9_]{2,}\b)/.test(first) && !FS_DIRECT.test(first)) return false;
    if (fsToolFile) return true;
    // Outside a tool file: Python `args.x` is argparse, and userDir / userDataDir /
    // USER_DATA_DIR are the app's own per-user folders, not user-supplied paths.
    const direct = py ? /\b(?:arguments|params|kwargs)\s*(?:\.|\[)|\brequest\s*\.\s*(?:form|args|json|files|query_params)\b/.test(arg) : FS_DIRECT.test(arg);
    const named = FS_UNTRUSTED_NAME.test(first.replace(/\buser_?(?:data_?)?(?:dir|directory|home|folder|root)\w*/gi, '').replace(py ? /\b(?:args|payload|req|request)\b/g : /$^/, ''));
    return direct || named;
  };
  // ---- unrestricted file upload / web shell (T1505.003) ----
  // A WRITE sink whose destination name/extension the caller controls, with no
  // extension or content-type allowlist, lets a caller drop an executable
  // (.php/.jsp/.aspx) — a web shell when the directory is served. This is the
  // attacker-chosen-extension case, distinct from the path-traversal flag above,
  // and a path-confinement guard does not stop it (a confined write into
  // public/uploads/ is exactly the web-shell drop). Flagged only with evidence
  // that the destination is web-served or the file handles uploads; otherwise
  // a caller-chosen write path stays an `fs` finding. Suppressed when the file
  // has a real extension allowlist, a MIME/content-type comparison near the
  // write, the destination's extension is pinned to a literal, or the name is
  // server-generated (uuid/nanoid/timestamp/hash/temp).
  const UPLOAD_WRITE = /\b(?:fs(?:\.promises)?\.)?(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream)\s*\(/;
  // File-scoped: checks that only make sense as an extension/type allowlist.
  const UPLOAD_EXT_ALLOW = /extname\s*\(|\.endsWith\s*\(\s*['"`]\.[A-Za-z0-9]|\.suffix\s*(?:\.\s*lower\s*\(\s*\)\s*)?(?:not\s+)?in\b|splitext\s*\(|allowed_?(?:ext|extensions|types|mime_?types|mimes)|ALLOWED_(?:EXT|EXTENSIONS|TYPES|MIME)|file_?filter|fileFilter|whitelist|\bimghdr\b|python-?magic|\bmagic\s*\.|file-?type|\.sniff\s*\(/i;
  // Region-scoped: a MIME/content-type comparison. `mimeType` is also an MCP
  // protocol field and `accept:` an ordinary request header, so a bare mention
  // anywhere in the file is not evidence; a comparison near the write is.
  const UPLOAD_MIME_CHECK = /\b(?:mime_?type|content_?type)\b\s*(?:===?|!==?|(?:not\s+)?in\b|\.\s*(?:startsWith|startswith|match|test|includes)\s*\()|\.\s*(?:includes|has)\s*\(\s*[\w$.?]*\b(?:mime_?type|content_?type)\b|\bcontent-type\b['"`]?\s*\]?\s*(?:===?|!==?|(?:not\s+)?in\b)/i;
  const UPLOAD_SERVER_NAMED = /randomUUID|\buuid\d?\b|\bnanoid\b|Date\.now|crypto\s*\.\s*randomBytes|secrets\s*\.\s*token|mkstemp|NamedTemporaryFile|\btempfile\b|createHash|hashlib|slugify|\bcuid\b/i;
  const UPLOAD_WEB_DIR = /public|static|\bwww\b|htdocs|wwwroot|webroot|\buploads?\b|\bdist\b|\bhtml\b|document_?root|site[_-]?root|serve[_-]?dir/i;
  // The file receives uploads or serves a directory over HTTP.
  const UPLOAD_HANDLER = /\bmulter\b|\bbusboy\b|\bformidable\b|express-fileupload|\breq(?:uest)?\s*\.\s*files?\b|\bUploadFile\b|multipart\/form-data|express\s*\.\s*static\s*\(|\bserveStatic\b|@fastify\/static|\bStaticFiles\s*\(|send_from_directory|static_folder/;
  const uploadHandler = UPLOAD_HANDLER.test(code);
  const WRITE_MODE = `['"][rbt+]*[wax][rbt+]*['"]`;
  const pyWriteMode = (a: string) => {
    const parts = argList(a);
    if (parts.length > 1 && new RegExp('^' + WRITE_MODE + '$').test(parts[1])) return true;   // positional mode
    return parts.some((p) => new RegExp('^mode\\s*=\\s*' + WRITE_MODE + '$').test(p));       // mode= in any position
  };
  // Extension pinned to a literal at the END of the destination expression
  // (`name + '.png'`, `${id}.json`, f"{x}.txt", .with_suffix(".txt")); trailing
  // no-arg method calls such as .trim() are ignored, not read as an extension.
  const extPinned = (dest: string) => /\.[A-Za-z0-9]{1,6}['"`]\s*\)*$/.test(dest.trim().replace(/(?:\s*\.\s*[A-Za-z_$][\w$]*\s*\(\s*\))+$/, ''));
  const mimeNear = (idx: number) => UPLOAD_MIME_CHECK.test(code.slice(Math.max(0, idx - 1500), idx + 300));
  for (const m of code.matchAll(fsPat)) {
    const idx = m.index ?? 0; if (inStr(idx)) continue;
    const arg = callArg(code, code.indexOf('(', idx));
    // Python pathlib methods take the path from the receiver, not the arguments.
    const viaReceiver = py && m[0].startsWith('.');
    const subject = viaReceiver ? receiverExpr(code, idx) : arg;
    const dest = viaReceiver ? subject : firstArg(arg);
    if (!argIsDynamic(subject, py)) { add('fs', 'ok', idx, 'filesystem call with a literal path'); continue; }
    if (SYS_ROOT.test(subject)) { add('fs', 'ok', idx, 'filesystem call rooted at a system/config path (homedir/env/dirname/tmp/cwd)'); continue; }
    const input = INPUT.test(subject);
    const toolInput = input && fsToolReach(subject);
    const isWrite = py
      ? /^\.write_(?:text|bytes)/.test(m[0]) || (/^(?:aiofiles\.)?open$/.test(m[1] ?? '') && pyWriteMode(arg)) || (m[1] === 'os.open' && /\bO_(?:WRONLY|RDWR|CREAT|APPEND|TRUNC)\b/.test(arg))
      : UPLOAD_WRITE.test(m[0]);
    const served = UPLOAD_WEB_DIR.test(dest) || UPLOAD_WEB_DIR.test(rel);
    if (toolInput && isWrite && !extPinned(dest) && (served || uploadHandler)
        && !UPLOAD_EXT_ALLOW.test(code) && !mimeNear(idx) && !UPLOAD_SERVER_NAMED.test(subject)) {
      add('upload', risky, idx, `write sink whose file name/extension comes from the tool/request with no extension or content-type allowlist${served ? ', into what looks like a web-served directory' : ' in a file that receives uploads or serves files over HTTP'} — a web shell (T1505.003): a caller can write an executable such as .php/.jsp/.aspx${guarded ? '; the resolve()+containment guard in this file keeps the write inside the directory but does not stop an executable extension' : ''}. Allowlist the extension/MIME and store outside the web root under a server-generated name`);
    }
    else if (guarded) add('fs', 'ok', idx, 'filesystem call with a variable path; a resolve()+containment guard exists in this file (confirm it covers this path)');
    else if (input && !toolInput) add('fs', 'ok', idx, 'filesystem call with a path variable in a file that defines no tool handler and does not read the tool arguments (not traced to tool input)');
    else if (input) add('fs', risky, idx, 'filesystem call with a tool/request-derived path and no resolve()+base-prefix guard in this file — normalize with realpath/path.resolve and enforce a base directory');
    else add('fs', 'ok', idx, 'filesystem call with an internal variable path (not tool-derived)');
  }

  // ---- dynamic code and unsafe deserialization ----
  // eval / new Function / vm.run* (JS) and eval / exec / pickle / yaml.load /
  // marshal (Python) on a value that is not a literal. Risky where tool input
  // exists (same reach test as fs); elsewhere it is reported as a note.
  {
    const codePat = py
      ? /(?<![.\w])(eval|exec)\s*\(|\b(pickle|cPickle|dill|marshal)\s*\.\s*(loads?)\s*\(|\byaml\s*\.\s*(load|unsafe_load|full_load)\s*\(/g
      : /(?<![.\w$])(eval)\(|\bnew\s+(Function)\s*\(|\bvm\s*\.\s*(runInNewContext|runInContext|runInThisContext|compileFunction)\s*\(|\bnew\s+vm\s*\.\s*(Script)\s*\(/g;
    for (const m of code.matchAll(codePat)) {
      const idx = m.index ?? 0; if (inStr(idx)) continue;
      if (/\b(?:def|function|async)\s+$/.test(code.slice(Math.max(0, idx - 12), idx))) continue;   // a method named eval/exec
      const what = m[0].replace(/\s*\($/, '').replace(/\s+/g, ' ');
      const arg = callArg(code, idx + m[0].length - 1);
      const args = argList(arg);
      // new Function('a', 'b', body): the last argument is the code.
      const subject = (/Function$/.test(what) ? args[args.length - 1] : args[0]) ?? '';
      if (!subject.trim()) continue;
      // `eval(script: string) {` / `eval(a, b): T` is a method declaration, not a call.
      const close = idx + m[0].length - 1 + arg.length + 1;
      if (!py && /^\s*(?::|\{)/.test(code.slice(close + 1, close + 12)) && /^\s*[\w$]+\s*[:,)?]/.test(arg + ')')) continue;
      // A template that only splices in UPPER_CASE constants is fixed text.
      if (/^`/.test(subject.trim()) && [...subject.matchAll(/\$\{([^}]*)\}/g)].every((x) => /^\s*[A-Z][A-Z0-9_]*\s*$/.test(x[1]))) { add('code', 'ok', idx, `${what} on constant text`); continue; }
      const isDeser = /pickle|dill|marshal|yaml/i.test(what);
      if (/^yaml/.test(what) && /Loader\s*=\s*(?:yaml\s*\.\s*)?(?:Safe|CSafe|Base)Loader/.test(arg)) { add('code', 'ok', idx, 'yaml.load with a safe loader'); continue; }
      const lit = subject.trim();
      if (/^[rbuRBU]*(['"])(?:(?!\1)[^\\]|\\.)*\1$/.test(lit) || /^`[^`$]*`$/.test(lit) || !argIsDynamic(subject, py)) { add('code', 'ok', idx, `${what} on a literal`); continue; }
      const reach = isDeser ? (FS_DIRECT.test(subject) || FS_UNTRUSTED_NAME.test(subject)) : fsToolReach(subject);
      if (reach) add('code', risky, idx, isDeser
        ? `${what} on a tool/request-derived value — this deserializer can run code from its input; use JSON or yaml.safe_load`
        : `${what} runs a string as code and the string is not a literal — if any part of it comes from a tool argument the caller runs code in this process; parse the input instead, or run it in a sandboxed process`);
      else add('code', 'ok', idx, `${what} on a non-literal value in a file with no tool input (not traced to tool input)`);
    }
  }

  // ---- SQL / data queries (statement shape + interpolation; linear, no backtracking) ----
  let sqlRisky = false;
  const flagSql = (idx: number, kind: string) => { add('sql', risky, idx, `SQL statement built by ${kind} interpolation — use placeholders (?, $1, :name) with a separate params argument, or an AST/allowlist guard`); sqlRisky = true; };
  const noteSql = (idx: number, kind: string) => add('sql', 'ok', idx, `read-only SELECT built by ${kind} interpolation of a table/column name only (no value, predicate or write) — placeholders cannot bind identifiers, so check the name against an allowlist if a caller can choose it`);
  // The one interpolated shape that is not treated as risky: a read-only SELECT
  // whose every interpolation is a table name (straight after FROM/JOIN) or sits
  // in the column list. Everything else stays risky: an interpolation in a value
  // or predicate position (quote-wrapped, after WHERE/=/LIMIT/ORDER BY, ...) and
  // ANY interpolation in a statement that writes or changes schema, where a
  // caller-chosen identifier is high impact. The test is positional, so
  // `WHERE name = '{term}'` stays risky whatever the variable is called.
  const WRITE_SQL = /\b(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT|ALTER|CREATE|REPLACE|MERGE|GRANT|REVOKE|ATTACH|COPY|EXEC|EXECUTE|CALL|PRAGMA)\b/i;
  const sqlBenignSelect = (s: Str): boolean => {
    const shape = sqlShape(s);
    if (!/\bSELECT\b/i.test(shape) || WRITE_SQL.test(shape) || shape.includes(';')) return false;
    const body = s.fstring ? s.body.replace(/\{\{|\}\}/g, '  ') : s.body;
    const fromAt = body.search(/\bFROM\b/i);
    let any = false;
    for (const m of body.matchAll(s.template ? /\$\{[^}]*\}/g : /\{[^{}]*\}/g)) {
      any = true;
      const i = m.index ?? 0;
      const before = body.slice(0, i), after = body.slice(i + m[0].length);
      if (/['"]\s*$/.test(before) && /^\s*['"]/.test(after)) return false;      // '${x}' is a value
      const tableName = /\b(?:FROM|JOIN)\s+$/i.test(before) && /^(?:\s|$|['"`]\s*$)/.test(after.replace(/^\s+(?:AS\s+)?\w+/i, ' '));
      const columnList = fromAt > i && /\bSELECT\b/i.test(before) && !/\b(?:WHERE|AND|OR|ON|HAVING|CASE|WHEN|THEN|ELSE|LIKE|IN|BETWEEN)\b|[=<>(]/i.test(before.slice(before.search(/\bSELECT\b/i) + 6));
      if (!tableName && !columnList) return false;
    }
    return any;
  };
  // A SQL string whose only interpolations are generated placeholder strings
  // (`IN (${placeholders})`, `{qmarks}`) is the correct parameterized idiom.
  const placeholderOnly = (body: string): boolean => {
    const re = py ? /\{([^}{]+)\}/g : /\$\{([^}]*)\}/g;
    let any = false;
    for (const m of body.matchAll(re)) {
      any = true;
      if (/placeholder|qmark|marks|slots|binding|\bph\b/i.test(m[1])) continue;
      if (/\b(?:IN|VALUES)\s*\(\s*$/i.test(body.slice(Math.max(0, (m.index ?? 0) - 8), m.index ?? 0))) continue;
      return false;
    }
    return any;
  };
  for (const s of strs) {
    if (!isSqlShape(sqlShape(s))) continue;
    if (s.interp && placeholderOnly(s.body)) continue;
    if (!py && s.template) { if (s.interp) (sqlBenignSelect(s) ? noteSql : flagSql)(s.start, 'a template literal'); }
    else if (!py) {
      const before = code.slice(Math.max(0, s.start - 2), s.start), after = code.slice(s.end, s.end + 2);
      if (/\+\s*$/.test(before) || /^\s*\+/.test(after)) flagSql(s.start, 'concatenation');
    } else if (s.fstring) { if (s.interp) (sqlBenignSelect(s) ? noteSql : flagSql)(s.start, 'an f-string'); }
    else if (/^\s*(?:%[^=]|\.format\s*\()/.test(code.slice(s.end, s.end + 10))) flagSql(s.start, '%/format');
  }
  if (!sqlRisky && STMT_RE.test(code) && /[?]|\$\d+|:\w+/.test(code)) {
    const mi = code.search(STMT_RE);
    add('sql', 'ok', mi < 0 ? 0 : mi, 'SQL present as a parameterized/literal query (placeholders detected)');
  }

  // ---- SSRF: an outbound request whose URL the caller chooses ----
  // Flags fetch/axios/got/http.get (JS) and requests/httpx/urlopen (Python) when
  // the URL argument is taken from the tool call or request. A URL built on a
  // fixed base ("https://api.acme.test/" + id) is not flagged: the caller cannot
  // move the host. An allowlist or private-address check anywhere in the file
  // turns the finding into a "confirm it covers this call" note.
  {
    const SSRF_GUARD = /\bssrf\b|allow[-_]?list|allowed_?(?:hosts|domains|origins|urls)|block[-_]?list|deny[-_]?list|is_?private|private[-_ ]?(?:ip|addr|network|range)|is_?loopback|169\.254\.169\.254|ip_address\s*\(|is_global|validate_?url|assert\w*url|safe_?fetch|safe_?url|ipaddr\b|isIP\s*\(|\bnetguard\b|check_?url|is_?safe_?url|is_?allowed_?(?:url|host)/i;
    const guarded = SSRF_GUARD.test(code);
    const toolFile = py ? /@\w*\.?tool\b|FastMCP|call_tool|list_tools/.test(code) : /\b(?:registerTool|setRequestHandler)\s*\(|\.tool\s*\(|\bz\s*\.\s*(?:string|object)\s*\(/.test(code);
    // `args.url`, `params["endpoint"]`, `req.body.url`: the expression must START at the
    // tool-argument object and read a URL-like property. `TABLE[input.kind].tokenUrl`
    // (a constant looked up by a tool value) is a fixed address, not a caller-chosen one.
    const URL_PROP = /^(?:url|uri|href|link|endpoint|host|hostname|base|base_?url|baseURL|origin|target\w*|webhook\w*|callback\w*|\w*(?:Url|URL|_url|Uri|URI|_uri))$/;
    const direct = (a: string): boolean => {
      const m = a.match(/^(args|arguments|params|kwargs|payload|input|inputs|req(?:uest)?\s*\.\s*(?:body|query|params))\s*(?:\?\.|\.|\[\s*['"`])\s*([A-Za-z_$][\w$]*)/);
      if (!m || !URL_PROP.test(m[2])) return false;
      // `input` is also the usual name of an internal options object; trust it only beside a tool handler.
      return /^inputs?$/.test(m[1]) ? toolFile : true;
    };
    const URLISH = /^(?:url|uri|href|link|endpoint|webhook\w*|target\w*|\w*(?:Url|URL|_url|Uri|URI|_uri))$/;
    const fixedBase = (name: string) => new RegExp(py
      ? '(?:^|\\n)\\s*' + esc(name) + '\\s*=\\s*[rf]*[\'"]https?://[\\w.-]'
      : '(?:const|let|var)\\s+' + esc(name) + '\\s*(?::[^=]+)?=\\s*(?:[\'"`]https?://[\\w.-]|`\\$\\{\\s*[\\w.]*(?:BASE|base|API|Api|HOST|Host|host|ORIGIN|origin|ENDPOINT|endpoint)\\w*\\s*\\}|new\\s+URL\\s*\\(\\s*(?:[\'"`]https?://|[^,()]+,))').test(code);
    const isParam = (name: string) => new RegExp(py
      ? '@[\\w.]*tool\\b[^\\n]*\\n(?:\\s*@[^\\n]*\\n)*\\s*(?:async\\s+)?def\\s+\\w+\\s*\\([^)]*\\b' + esc(name) + '\\b'
      : '\\{[^{}]*\\b' + esc(name) + '\\b[^{}]*\\}\\s*(?::[^=()]{0,120})?\\)\\s*(?::[^=]{0,60})?=>').test(code);
    const callerChosen = (raw: string): boolean => {
      let a = raw.trim().replace(/^(?:await\s+|String\s*\(|str\s*\(|(?:urllib\s*\.\s*request\s*\.\s*)?Request\s*\()/, '').split(/,(?![^(\[{]*[)\]}])/)[0];
      if (/^\{/.test(a)) return false;                       // an options object, not a URL
      const kw = a.match(/^url\s*=\s*(.+)$/s); if (kw) a = kw[1].trim();
      // A string that starts with a literal scheme and host has a fixed base.
      if (/^[rfbu]*['"`]https?:\/\/[\w.-]/i.test(a)) return false;
      // `${x}/path` or f"{x}/path": judge the leading expression.
      const lead = a.match(/^`\$\{([^}]+)\}/) ?? a.match(/^[rf]+['"]\{([^}]+)\}/i);
      if (lead) a = lead[1].trim();
      else if (/^['"`]/.test(a)) return false;
      if (direct(a)) return true;
      const id = a.match(/^[A-Za-z_$][\w$]*$/)?.[0];
      return !!id && URLISH.test(id) && toolFile && isParam(id) && !fixedBase(id);
    };
    const calls = py
      ? /(?<![.\w])(?:requests|httpx)\s*\.\s*(get|post|put|patch|delete|head|request)\s*\(|(?<![\w])urlopen\s*\(/g
      : /(?<![.\w$])fetch\s*\(|(?<![.\w$])(?:axios|got|ky)\s*(?:\.\s*(get|post|put|patch|delete|head|request))?\s*\(|(?<![.\w$])https?\s*\.\s*(get|request)\s*\(/g;
    // Browser front-end assets are out of scope. Python needs a tool handler in the
    // file (`args.` is usually argparse there); in JS `args.url` / `input.url` is
    // evidence enough, since the fetch helper often lives beside the tool file.
    const inScope = (toolFile || !py) && !/(?:^|[\\/])(?:static|public|assets|www|web)[\\/]/.test(rel);
    for (const m of inScope ? code.matchAll(calls) : []) {
      const idx = m.index ?? 0; if (inStr(idx)) continue;
      const args = argList(callArg(code, idx + m[0].length - 1));
      const arg = (py && m[1] === 'request' ? args[1] : args[0]) ?? '';
      if (!arg || !callerChosen(arg)) continue;
      if (guarded) add('ssrf', 'ok', idx, 'outbound request to a caller-chosen URL; this file has an allowlist or private-address check (confirm it covers this call)');
      else add('ssrf', risky, idx, 'outbound request to a tool/request-derived URL with no host allowlist or private-address check in this file — a caller can point the server at localhost, LAN or cloud-metadata addresses; resolve the host and refuse private ranges, or allowlist hosts');
    }
  }

  // ---- transport exposure (MCP HTTP listeners: loopback bind + DNS-rebinding) ----
  // The MCP spec (Streamable HTTP, 2025-11-25 / 2026-07-28) requires local HTTP
  // servers to bind loopback and validate Origin/Host to stop LAN exposure and
  // browser DNS-rebinding (CVE-2026-57123, CVE-2026-59971). Near-zero-FP gate:
  // only inspect files that actually stand up an MCP HTTP transport.
  const mcpHttp = MCP_HTTP_TRANSPORT.test(code)
    || (/\bMcpServer\b/.test(code) && (/\bexpress\b/.test(code) || /\bhttp\.createServer\b/.test(code) || /\bcreateServer\s*\(/.test(code)));
  // A file that validates the Host/Origin header by hand (not via the SDK flag)
  // has the equivalent DNS-rebinding / direct-IP defense, so suppress the flag.
  const manualHostCheckInFile = /\benableDnsRebindingProtection\s*:\s*true\b|\b(?:validate|check|verify|assert)(?:Host|Origin)\w*\s*\(|\ballowedHosts\b|\ballowedOrigins\b|req\.headers\s*\[\s*['"]host|req\.headers\.(?:host|origin)|headers\s*\[\s*['"]origin/i.test(code);
  const inFileGuard = manualHostCheckInFile || SDK_HOST_GUARD.test(code);
  const manualHostCheck = inFileGuard || sdkHostGuard;
  const guardNote = inFileGuard ? 'the file performs a manual Host/Origin check' : 'the project mounts the MCP SDK Host-validation middleware (confirm it covers this route)';
  // A serverless function (Vercel/Netlify/Workers/Next route handler) with no
  // listen() call is a public endpoint by deployment: there is no loopback to
  // protect, so browser-reachability rules are reported as a note.
  const serverless = !py && !/\.listen\s*\(|\bserve\s*\(\s*\{/.test(code) && /export\s+default\s+(?:async\s+)?function\s+handler\b|export\s+(?:async\s+function|const)\s+(?:GET|POST|OPTIONS)\b|export\s+default\s*\{\s*(?:async\s+)?fetch\b|export\s+const\s+config\s*=\s*\{[^}]*runtime/.test(code);
  // (0a) A loopback test done with a substring match lets other machines pass:
  // "fe80::1a2b" and "2001:db8::1" both contain "::1".
  for (const m of code.matchAll(py ? SUBSTR_LOOPBACK_PY : SUBSTR_LOOPBACK_JS)) {
    const idx = m.index ?? 0;
    add('transport', risky, idx, 'loopback test by substring — ordinary IPv6 addresses such as fe80::1a2b contain "::1", so other machines pass as local; normalise the address and compare it exactly (and check Host/Origin for browser requests)');
  }
  // (0b) CORS open to every origin on an MCP HTTP server, in a file that applies
  // no authentication: any website the user visits can call it and read replies.
  if (!py && projectMcpHttp && (mcpHttp || /['"`]\/(?:mcp|sse|messages?)\b/.test(code)) && !authenticates(code) && !manualHostCheck) {
    for (const m of code.matchAll(CORS_ANY)) {
      const idx = m.index ?? 0; if (inStr(idx) && !/Access-Control/.test(m[0])) continue;
      if (serverless) { add('transport', 'ok', idx, 'CORS allows every origin on a serverless MCP handler with no authentication in this file — a public endpoint by deployment; confirm it is meant to be open to everyone'); continue; }
      add('transport', risky, idx, `CORS allows every origin on an MCP HTTP server and this file ${OPTIONAL_AUTH.test(code) ? 'only authenticates when a credential is configured' : 'applies no authentication'} — any website the user visits can call the server and read its replies; restrict origins to the ones you serve, or require a token`);
    }
  }
  // ---- WebSocket transport: Origin/Host validation on the upgrade (CVE-2026-59950) ----
  // The MCP WebSocket transport must validate Host/Origin before accepting the
  // upgrade, or any page the user visits can open a socket to a localhost MCP
  // server and drive its tools (cross-site WebSocket hijacking). The Python mcp
  // SDK's websocket_server() had no such check before 1.28.1 — the HTTP
  // transports' TransportSecurityMiddleware was never applied to it. Gated to MCP
  // files to keep false positives near zero.
  // Both the MCP evidence and the guard evidence are per file / per socket: a
  // project-wide HTTP transport elsewhere does not make an unrelated dev or UI
  // socket an MCP transport, and HTTP Host-validation middleware (express /
  // createMcpExpressApp, enableDnsRebindingProtection, allowedHosts) never runs
  // on a WebSocket upgrade, so it does not count as a guard here.
  {
    const mcpMarker = mcpHttp || /\bMcpServer\b|FastMCP|@\w*\.?tool\b|['"`]\/mcp\b|modelcontextprotocol|from\s+mcp\b|websocket_server\s*\(/.test(code);
    const wsCtor = py
      ? /\bwebsocket_server\s*\(|\b(?:websocket|ws)\s*\.\s*accept\s*\(/g
      : /new\s+(?:WebSocketServer|WebSocket\s*\.\s*Server|ws\s*\.\s*Server)\s*\(|\.\s*handleUpgrade\s*\(/g;
    // Python: a TransportSecuritySettings(...) built with rebinding protection
    // switched off is not a guard; drop those calls before looking for one.
    const pyGuardCode = py ? code.replace(/\bTransportSecuritySettings\s*\((?:[^()]|\([^()]*\))*\benable_dns_rebinding_protection\s*=\s*False\b(?:[^()]|\([^()]*\))*\)/g, '') : code;
    const wsGuardInFile = authenticates(code)
      || (py ? /\bTransportSecuritySettings\s*\(|allowed_?origins|check_?origin|verify_?origin|headers\s*(?:\.\s*get\s*\(|\[)\s*['"](?:origin|host)['"]/i
             : /verifyClient|check_?Origin|verify_?Origin|originAllowed|isAllowedOrigin|allowedOrigins|\b(?:validate|check|verify|assert)(?:Host|Origin)\w*\s*\(|req(?:uest)?\s*\.\s*headers\s*(?:\.\s*(?:origin|host)\b|\[\s*['"`](?:origin|host)['"`])/i).test(pyGuardCode);
    if (mcpMarker) for (const m of code.matchAll(wsCtor)) {
      const idx = m.index ?? 0; if (inStr(idx)) continue;
      const opts = /^new\b/.test(m[0]) ? callArg(code, code.indexOf('(', idx)) : '';
      if (wsGuardInFile || /\bverifyClient\b/.test(opts)) add('transport', 'ok', idx, 'WebSocket MCP transport; this file validates Host/Origin or authenticates before accepting the upgrade (confirm it covers this socket)');
      else add('transport', risky, idx, 'WebSocket MCP transport accepts upgrades with no Host/Origin check in this file — a page on any site the user visits can open a socket to a localhost MCP server and call its tools (cross-site WebSocket hijacking; cf. CVE-2026-59950); validate Host/Origin before accept: pass TransportSecuritySettings on the Python SDK, or verifyClient / an Origin allowlist in JS (HTTP Host-validation middleware does not run on the upgrade)');
    }
  }
  if (!py && mcpHttp) {
    // (1) StreamableHTTPServerTransport constructed without DNS-rebinding protection.
    for (const m of code.matchAll(/new\s+StreamableHTTPServerTransport\s*\(/g)) {
      const idx = m.index ?? 0; if (inStr(idx)) continue;
      const opts = callArg(code, code.indexOf('(', idx));
      if (/\benableDnsRebindingProtection\s*:\s*true\b/.test(opts))
        add('transport', 'ok', idx, 'StreamableHTTPServerTransport with enableDnsRebindingProtection: true');
      else if (manualHostCheck)
        add('transport', 'ok', idx, `StreamableHTTPServerTransport without the SDK flag, but ${guardNote}${inFileGuard ? ' (confirm it is an allowlist)' : ''}`);
      else if (authenticates(code))
        // DNS rebinding lets a browser page reach the server as same-origin, but a
        // request that must carry a bearer token / API key the page does not hold
        // still fails. With auth in this file the rebinding path dead-ends at a 401,
        // so this is a hardening note, not a risky exposure. (Confirm every tool
        // route is actually behind that auth, not just some of them.)
        add('transport', 'ok', idx, 'StreamableHTTPServerTransport without enableDnsRebindingProtection: true, but this file authenticates requests — DNS rebinding dead-ends at auth; set the flag anyway as defence in depth, and confirm every route is behind the check');
      else if (serverless)
        add('transport', 'ok', idx, 'StreamableHTTPServerTransport in a serverless handler (public endpoint; DNS rebinding does not apply)');
      else
        add('transport', risky, idx, 'StreamableHTTPServerTransport constructed without enableDnsRebindingProtection: true — a page on another origin can reach this server via DNS rebinding; set enableDnsRebindingProtection: true with allowedHosts/allowedOrigins');
    }
    // (2) HTTP listener bind host: omitted / callback-as-2nd-arg / 0.0.0.0 == all interfaces.
    const CB_NAME = /^(?:cb|callback|done|listener|fn|next|resolve|onListen|onListening)$/i;
    for (const m of code.matchAll(/\.listen\s*\(/g)) {
      const idx = m.index ?? 0; if (inStr(idx)) continue;
      const args = argList(callArg(code, code.indexOf('(', idx)));
      // listen({ port, host }) / listen({ path }) / listen('/run/app.sock'): the first argument
      // carries the address. A path is a Unix socket or named pipe, not a network bind.
      const first = (args[0] ?? '').trim();
      if (/^\{/.test(first) && /\bpath\s*:/.test(first) && !/\bport\s*:/.test(first)) { add('transport', 'ok', idx, 'listener on a Unix socket or named pipe (not a network bind)'); continue; }
      if (/^['"`](?:\/|\\\\\.\\pipe\\)[^'"`]*['"`]$/.test(first)) { add('transport', 'ok', idx, 'listener on a Unix socket or named pipe (not a network bind)'); continue; }
      const objHost = /^\{/.test(first) ? (/\bhost(?:name)?\s*:\s*([^,}]+)/.exec(first)?.[1] ?? (/(?:^\{|,)\s*host(?:name)?\s*(?:,|\})/.test(first) ? 'host' : null)) : null;
      const host = (objHost ?? args[1] ?? '').trim();
      const quoted = /^['"`]([^'"`]*)['"`]/.exec(host);
      const isCallbackLit = host !== '' && !quoted && /^(?:async\b|function\b|\(|[A-Za-z_$][\w$]*\s*=>)/.test(host);
      const isNamedCb = args.length === 2 && !quoted && CB_NAME.test(host);
      const exposed = host === '' || /^(?:undefined|null|void\s+0)$/.test(host) || isCallbackLit || isNamedCb;
      if (quoted) {
        const h = quoted[1];
        if (/^(?:127\.0\.0\.1|localhost|::1|\[::1\])$/.test(h)) add('transport', 'ok', idx, `HTTP listener bound to loopback ('${h}')`);
        else if (/^(?:0\.0\.0\.0|::|\[::\]|)$/.test(h)) add('transport', manualHostCheck ? 'ok' : risky, idx, manualHostCheck ? `HTTP listener on '${h || '0.0.0.0'}' but ${guardNote}` : `HTTP listener bound to '${h || '0.0.0.0'}' (all interfaces) — exposes MCP tools to the LAN; bind 127.0.0.1/localhost unless remote exposure is intended and authenticated`);
        else add('transport', 'ok', idx, `HTTP listener bound to a configured host ('${h}')`);
      } else if (exposed) {
        add('transport', manualHostCheck ? 'ok' : risky, idx, manualHostCheck ? `HTTP listener with no explicit bind host, but ${guardNote}` : 'HTTP listener with no bind host (second arg is a callback or omitted) — Node defaults to 0.0.0.0 (all interfaces), exposing MCP tools to the LAN; pass 127.0.0.1/localhost as the host');
      } else {
        add('transport', 'ok', idx, 'HTTP listener bound to a configured host variable (confirm it defaults to loopback)');
      }
    }
  } else if (py && /\bFastMCP\b|streamable[_-]?http|mcp\.server|StreamableHTTP|SSEServerTransport/i.test(code)) {
    // Python: host bound to all interfaces — gated to real MCP HTTP files (a plain
    // Flask/Dash dashboard with app.run(host=...) is NOT an MCP transport). The host
    // can be set directly or via an os.getenv(..., "0.0.0.0") / os.environ.get(...,
    // "0.0.0.0") default fallback, and on uvicorn.run / mcp.run / app.run OR in the
    // FastMCP(...) constructor (FastMCP(host=...) is as exposing as mcp.run(host=...)).
    const ALL = '(?:0\\.0\\.0\\.0|::)';
    const LOOP = '(?:127\\.0\\.0\\.1|localhost)';
    const envDefault = (ip: string) => `os\\.(?:getenv|environ\\.get)\\s*\\([^)]*,\\s*['"]${ip}['"]\\s*\\)`;
    const allIface = new RegExp(`\\bhost\\s*=\\s*(?:['"]${ALL}['"]|${envDefault(ALL)})`);
    const loopHost = new RegExp(`\\bhost\\s*=\\s*(?:['"]${LOOP}['"]|${envDefault(LOOP)})`);
    for (const m of code.matchAll(/\b(?:uvicorn\.run|FastMCP|[A-Za-z_][\w.]*\.run)\s*\(/g)) {
      const idx = m.index ?? 0; if (inStr(idx)) continue;
      const opts = callArg(code, code.indexOf('(', idx));
      if (allIface.test(opts))
        add('transport', risky, idx, "MCP HTTP server bound to host='0.0.0.0' (all interfaces) — exposes tools on the LAN; bind host='127.0.0.1' unless remote exposure is intended and authenticated");
      else if (loopHost.test(opts))
        add('transport', 'ok', idx, 'MCP HTTP server bound to a loopback host');
    }
  }
  return out;
}
