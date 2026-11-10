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
  'benchmark', 'benchmarks', 'bench', 'fixtures',
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
 */
export async function sinks(dir = '.', options: SinksOptions = {}) {
  try {
    const strict = !!options.strict;
    const sources = await collect(dir);
    const results: Result[] = [];
    let risky = 0, safe = 0, scanned = 0;
    for (const f of sources) {
      const raw = await readFile(f.path, 'utf8').catch(() => null);
      if (raw === null || raw.length > MAX_BYTES) continue;
      scanned++;
      const code = stripComments(raw, f.py);
      for (const h of scanFile(code, f.py, f.rel, strict)) {
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
async function collect(dir: string) {
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

function argIsDynamic(arg: string, py: boolean): boolean {
  const a = arg.trim();
  if (/\$\{/.test(a)) return true;
  if (/\+/.test(a)) return true;
  if (py && /\bf['"]/.test(a)) return true;
  if (py && (/%\s*[(\w"']/.test(a) || /\.format\s*\(/.test(a))) return true;
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
  return { ns, fns };
}

// A SQL statement shape (two-token anchored), not a lone keyword.
const STMT = '(?:SELECT\\b[\\s\\S]{0,200}?\\bFROM\\b|INSERT\\s+INTO\\b|UPDATE\\b[\\s\\S]{0,120}?\\bSET\\b|DELETE\\s+FROM\\b|CREATE\\s+(?:TABLE|INDEX|VIEW|TRIGGER)\\b|DROP\\s+(?:TABLE|INDEX|VIEW)\\b|ALTER\\s+TABLE\\b|TRUNCATE\\b|REPLACE\\s+INTO\\b)';
const STMT_RE = new RegExp(STMT, 'i');

interface Str { start: number; end: number; body: string; template: boolean; fstring: boolean; interp: boolean }
// Single linear pass (no backtracking) collecting string-literal spans and
// whether each interpolates. Runs on comment-stripped code, so delimiters are
// intact and comments are gone.
function collectStrings(code: string, py: boolean): Str[] {
  const out: Str[] = []; const n = code.length; let i = 0;
  while (i < n) {
    const c = code[i];
    if (!py && c === '`') {
      const start = i; let interp = false; i++;
      for (; i < n; i++) { if (code[i] === '\\') { i++; continue; } if (code[i] === '$' && code[i + 1] === '{') interp = true; if (code[i] === '`') break; }
      out.push({ start, end: i + 1, body: code.slice(start + 1, i), template: true, fstring: false, interp }); i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const start = i; const p1 = code[i - 1] || '', p2 = code[i - 2] || '';
      const fstring = py && (/[fF]/.test(p1) || (/[rRbB]/.test(p1) && /[fF]/.test(p2)));
      const triple = code[i + 1] === c && code[i + 2] === c;
      let interp = false; i += triple ? 3 : 1;
      for (; i < n; i++) {
        if (code[i] === '\\') { i++; continue; }
        if (fstring && code[i] === '{' && code[i + 1] !== '{') interp = true;
        if (triple) { if (code[i] === c && code[i + 1] === c && code[i + 2] === c) break; }
        else if (code[i] === c) break;
      }
      const end = triple ? i + 3 : i + 1;
      out.push({ start, end, body: code.slice(start, end), template: false, fstring, interp });
      i = end; continue;
    }
    i++;
  }
  return out;
}

function scanFile(code: string, py: boolean, rel: string, strict: boolean): Result[] {
  const out: Result[] = [];
  const lineAt = lineIndexer(code);
  const risky: Level = strict ? 'error' : 'warn';
  const add = (id: string, level: Level, idx: number, msg: string) => out.push({ id, level, message: `${rel}:${lineAt(idx)} — ${msg}` });

  // String-literal spans: an exec/fs "call" that falls inside a string literal
  // (e.g. the token "os.system(" in a linter's rule list) is not a real call.
  const strs = collectStrings(code, py);
  const inStr = (i: number) => strs.some((s) => i >= s.start && i < s.end);

  // ---- process execution ----
  if (!py) {
    const { ns, fns } = jsCpBindings(code);
    const classify = (real: string, idx: number, how: string) => {
      if (inStr(idx)) return;
      const arg = callArg(code, code.indexOf('(', idx));
      if (real === 'exec' || real === 'execSync') {
        if (argIsDynamic(arg, py)) add('exec', risky, idx, `child_process.${real} (${how}) runs a shell with a variable/interpolated command — use execFile([...]) with an argument array`);
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
      if (/\bshell\s*=\s*True\b/.test(arg)) add('exec', risky, idx, `subprocess.${m[1]}(..., shell=True) runs a shell — use a list argument with shell=False`);
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
    ? /\b(open|os\.open|os\.remove|os\.unlink|os\.rename|shutil\.(?:copy|copyfile|move|rmtree))\s*\(|\.(?:read_text|write_text|read_bytes|write_bytes)\s*\(/g
    : /\b(?:fs(?:\.promises)?\.)?(?:readFile|readFileSync|writeFile|writeFileSync|appendFile|appendFileSync|createReadStream|createWriteStream|unlinkSync|readdirSync)\s*\(|\bfs(?:\.promises)?\.(?:open|openSync|unlink|rm|rmSync|readdir|copyFile|rename|renameSync|stat|statSync)\s*\(/g;
  // Only flag when the path plausibly comes from a tool/request argument; an
  // internal variable path (app state/working files) is low-value here and
  // local-only, so it is reported ok rather than warned on.
  const INPUT = /\breq\b|\brequest\b|\bparams?\b|\bquery\b|\bbody\b|\bpayload\b|\binput\b|\bargs?\b|\barguments\b|\buser[_A-Za-z0-9]*\b|\bupload\b|\bfilename\b|\bfilepath\b|file_path|\bdestination\b|\bdest\b|\btarget\b|output_?path/i;
  for (const m of code.matchAll(fsPat)) {
    const idx = m.index ?? 0; if (inStr(idx)) continue;
    const arg = callArg(code, code.indexOf('(', idx));
    if (!argIsDynamic(arg, py)) add('fs', 'ok', idx, 'filesystem call with a literal path');
    else if (SYS_ROOT.test(arg)) add('fs', 'ok', idx, 'filesystem call rooted at a system/config path (homedir/env/dirname/tmp/cwd)');
    else if (guarded) add('fs', 'ok', idx, 'filesystem call with a variable path; a resolve()+containment guard exists in this file (confirm it covers this path)');
    else if (INPUT.test(arg)) add('fs', risky, idx, 'filesystem call with a tool/request-derived path and no resolve()+base-prefix guard in this file — normalize with realpath/path.resolve and enforce a base directory');
    else add('fs', 'ok', idx, 'filesystem call with an internal variable path (not tool-derived)');
  }

  // ---- SQL / data queries (statement shape + interpolation; linear, no backtracking) ----
  let sqlRisky = false;
  const flagSql = (idx: number, kind: string) => { add('sql', risky, idx, `SQL statement built by ${kind} interpolation — use placeholders (?, $1, :name) with a separate params argument, or an AST/allowlist guard`); sqlRisky = true; };
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
    if (!STMT_RE.test(s.body)) continue;
    if (s.interp && placeholderOnly(s.body)) continue;
    if (!py && s.template) { if (s.interp) flagSql(s.start, 'a template literal'); }
    else if (!py) {
      const before = code.slice(Math.max(0, s.start - 2), s.start), after = code.slice(s.end, s.end + 2);
      if (/\+\s*$/.test(before) || /^\s*\+/.test(after)) flagSql(s.start, 'concatenation');
    } else if (s.fstring) { if (s.interp) flagSql(s.start, 'an f-string'); }
    else if (/^\s*(?:%[^=]|\.format\s*\()/.test(code.slice(s.end, s.end + 10))) flagSql(s.start, '%/format');
  }
  if (!sqlRisky && STMT_RE.test(code) && /[?]|\$\d+|:\w+/.test(code)) {
    const mi = code.search(STMT_RE);
    add('sql', 'ok', mi < 0 ? 0 : mi, 'SQL present as a parameterized/literal query (placeholders detected)');
  }
  return out;
}
