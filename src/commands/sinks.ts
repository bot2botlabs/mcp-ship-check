import { readdir, readFile } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { message } from '../project.js';
import { finish, unavailable, type Result, type Level } from '../report.js';

export interface SinksOptions { strict?: boolean }

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'vendor', '__pycache__', '.git']);
const JS = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts']);
const PY = new Set(['.py']);
const MAX_FILES = 4000;
const MAX_BYTES = 512 * 1024;
const BOUND = 4000; // cap regex repetition to avoid catastrophic backtracking
const isTest = (p: string) => /(^|[\\/])tests?[\\/]|\.test\.|\.spec\.|(^|[\\/])test_[^\\/]*\.py$|_test\.py$/.test(p);

/**
 * Static "Safe Sinks" scan of a server's own source. Deterministic, offline,
 * never executes anything. It flags the SHAPE of a risky sink (an LLM-reachable
 * value flowing into process execution, the filesystem, or a SQL string) so a
 * human can review it — it is a targeting aid, never a vulnerability verdict.
 * Default severity is `warn`; `--strict` promotes risky shapes to `error`.
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
    if (scanned === 0) { results.push({ id: 'sinks', level: 'skip', message: 'no JS/TS or Python source found to scan (hosted relay or compiled-only package?)' }); return finish('sinks', results); }
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
      // Python module/function/class docstring: a triple-quoted string at
      // statement position (not f/r/b-prefixed). Strip so prose can't match.
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

// ── scanning ────────────────────────────────────────────────────────────────
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
  if (/\$\{/.test(a)) return true;                 // template interpolation
  if (/\+/.test(a)) return true;                   // concatenation
  if (py && /\bf['"]/.test(a)) return true;        // f-string
  if (py && (/%\s*[(\w"']/.test(a) || /\.format\s*\(/.test(a))) return true;
  if (/^[A-Za-z_$]/.test(a)) return true;          // bare identifier => variable
  return false;                                    // starts with a quote/[ and no interpolation => static/array
}

const SQL_KW = 'SELECT|INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|WHERE|FROM|JOIN';

function scanFile(code: string, py: boolean, rel: string, strict: boolean): Result[] {
  const out: Result[] = [];
  const lineAt = lineIndexer(code);
  const risky: Level = strict ? 'error' : 'warn';
  const add = (id: string, level: Level, idx: number, msg: string) => out.push({ id, level, message: `${rel}:${lineAt(idx)} — ${msg}` });

  // ---- process execution ----
  if (!py) {
    for (const m of code.matchAll(/\bexec(Sync)?\s*\(/g)) {
      const idx = m.index ?? 0, arg = callArg(code, idx + m[0].length - 1);
      if (argIsDynamic(arg, py)) add('exec', risky, idx, 'child_process.exec runs a shell with a variable/interpolated command — use execFile([...]) with an argument array');
      else add('exec', 'ok', idx, 'child_process.exec with a static literal command');
    }
    for (const m of code.matchAll(/\b(spawnSync|spawn|fork)\s*\(/g)) {
      const idx = m.index ?? 0, arg = callArg(code, idx + m[0].length - 1);
      if (/\bshell\s*:\s*true\b/.test(arg)) add('exec', risky, idx, `${m[1]} with { shell: true } runs a shell — drop shell:true and pass an argument array`);
      else add('exec', 'ok', idx, `${m[1]} without shell:true (argument-array form)`);
    }
    for (const m of code.matchAll(/\bexecFile(Sync)?\s*\(/g)) add('exec', 'ok', m.index ?? 0, 'execFile uses an argument array (no shell)');
  } else {
    for (const m of code.matchAll(/\bsubprocess\.(run|call|check_output|check_call|Popen)\s*\(/g)) {
      const idx = m.index ?? 0, arg = callArg(code, idx + m[0].length - 1);
      if (/\bshell\s*=\s*True\b/.test(arg)) add('exec', risky, idx, `subprocess.${m[1]}(..., shell=True) runs a shell — use a list argument with shell=False`);
      else add('exec', 'ok', idx, `subprocess.${m[1]} without shell=True`);
    }
    for (const m of code.matchAll(/\bos\.(system|popen)\s*\(/g)) add('exec', risky, m.index ?? 0, `os.${m[1]} runs a shell — use subprocess.run([...], shell=False)`);
    for (const m of code.matchAll(/\bcommands\.getoutput\s*\(/g)) add('exec', risky, m.index ?? 0, 'commands.getoutput runs a shell — use subprocess.run([...], shell=False)');
  }

  // ---- filesystem bounds (file-scoped guard detection) ----
  const guarded = py
    ? /os\.path\.realpath|realpath\s*\(|\.resolve\s*\(\)/.test(code) && /startswith|commonpath|relpath|['"]\.\.['"]/.test(code)
    : /path\.resolve|path\.normalize|realpath|\bresolve\s*\(|\bnormalize\s*\(/.test(code) && /startsWith|path\.relative|\brelative\s*\(|['"]\.\.['"]/.test(code);
  // Distinctive fs names are matched bare or fs.-qualified; generic names
  // (open/rm/rename/stat/readdir) only when fs.-qualified, to limit collisions.
  const fsPat = py
    ? /\b(open|os\.open|os\.remove|os\.unlink|os\.rename|shutil\.(?:copy|copyfile|move|rmtree))\s*\(|\.(?:read_text|write_text|read_bytes|write_bytes)\s*\(/g
    : /\b(?:fs(?:\.promises)?\.)?(?:readFile|readFileSync|writeFile|writeFileSync|appendFile|appendFileSync|createReadStream|createWriteStream|unlinkSync|readdirSync)\s*\(|\bfs(?:\.promises)?\.(?:open|openSync|unlink|rm|rmSync|readdir|copyFile|rename|renameSync|stat|statSync)\s*\(/g;
  for (const m of code.matchAll(fsPat)) {
    const idx = m.index ?? 0, open = code.indexOf('(', idx), arg = callArg(code, open);
    if (!argIsDynamic(arg, py)) add('fs', 'ok', idx, 'filesystem call with a literal path');
    else if (guarded) add('fs', 'ok', idx, 'filesystem call with a variable path; a resolve()+containment guard exists in this file (confirm it covers this path)');
    else add('fs', risky, idx, 'filesystem call with a variable path and no resolve()+base-prefix guard in this file — normalize with realpath/path.resolve and enforce a base directory');
  }

  // ---- SQL / data queries ----
  const sqlPats: [RegExp, string][] = py ? [
    [new RegExp('f(["\'])(?:(?!\\1).){0,' + BOUND + '}\\b(?:' + SQL_KW + ')\\b(?:(?!\\1).){0,' + BOUND + '}\\{', 'gis'), 'an f-string'],
    [new RegExp('(["\'])(?:(?!\\1).){0,' + BOUND + '}\\b(?:' + SQL_KW + ')\\b(?:(?!\\1).){0,' + BOUND + '}\\1\\s*(?:%|\\.format\\s*\\(|\\+)', 'gis'), '%/format/concatenation'],
  ] : [
    [new RegExp('`[^`]{0,' + BOUND + '}\\b(?:' + SQL_KW + ')\\b[^`]{0,' + BOUND + '}\\$\\{', 'gis'), 'a template literal'],
    [new RegExp('(["\'])(?:(?!\\1).){0,' + BOUND + '}\\b(?:' + SQL_KW + ')\\b(?:(?!\\1).){0,' + BOUND + '}\\1\\s*\\+', 'gis'), 'concatenation'],
  ];
  let sqlRisky = false;
  for (const [re, kind] of sqlPats) for (const m of code.matchAll(re)) { add('sql', risky, m.index ?? 0, `SQL built by ${kind} interpolation — use placeholders (?, $1, :name) with a separate params argument, or an AST/allowlist guard`); sqlRisky = true; }
  if (!sqlRisky) {
    const hasSql = new RegExp('(["\'])(?:(?!\\1).){0,' + BOUND + '}\\b(?:' + SQL_KW + ')\\b', 'i');
    const mi = code.search(hasSql);
    if (mi >= 0 && /[?]|\$\d+|:\w+/.test(code)) add('sql', 'ok', mi, 'SQL present as a parameterized/literal query (placeholders detected)');
  }
  return out;
}
