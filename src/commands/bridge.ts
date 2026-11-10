import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { finish, unavailable, type Result, type Level } from '../report.js';
import { BRIDGE_ADVISORIES, type BridgeAdvisory } from '../bridge-advisories.js';

export interface BridgeOptions { strict?: boolean }

/**
 * `bridge` — offline check of how clients are told to connect to a remote MCP
 * server through the `mcp-remote` bridge. It reads MCP client configs
 * (`claude_desktop_config.json`, `.mcp.json`, `mcp.json`, incl. `.cursor/` and
 * `.vscode/`) and fenced code blocks in Markdown docs, finds each `mcp-remote`
 * invocation, and checks the pinned version against known advisories plus the
 * `--allow-http` / `--device-code` flags. It never installs or runs anything.
 */

// Unlike `sinks`, docs/ and examples/ are scanned: that is where install snippets live.
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', 'vendor', '__pycache__', 'test', 'tests', '__tests__', 'fixtures']);
const CONFIG_NAMES = new Set(['claude_desktop_config.json', '.mcp.json', 'mcp.json']);
const MAX_FILES = 4000;
const MAX_BYTES = 512 * 1024;
// Exact package token only: `mcp-remote` or `mcp-remote@<spec>` (never `my-mcp-remote-x` or `@scope/mcp-remote`).
const PKG = /^mcp-remote(?:@(.+))?$/;
const EXACT = /^\d+\.\d+\.\d+$/;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

interface Tok { t: string; line: number }
interface Invocation { file: string; line: number; server?: string; spec?: string; url?: string; allowHttp: boolean; deviceCode: boolean }

const clean = (s: string) => s.replace(/^[\s"'`[(,{]+|[\s"'`\]),;:}]+$/g, '');
const lineAt = (text: string, idx: number) => text.slice(0, Math.max(0, idx)).split('\n').length;

function cmp(a: string, b: string): number {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0) ? -1 : 1;
  return 0;
}
const inRange = (v: string, a: BridgeAdvisory) =>
  (a.from === undefined || cmp(v, a.from) >= 0) && (a.toInclusive ? cmp(v, a.to) <= 0 : cmp(v, a.to) < 0);
const rangeText = (a: BridgeAdvisory) =>
  a.from ? `${a.from}–${a.to}${a.toInclusive ? '' : ' (exclusive)'}` : `< ${a.to}${a.toInclusive ? ' inclusive' : ''}`;

/** Each `mcp-remote` token owns the tokens after it, up to the next `mcp-remote` token. */
function fromTokens(toks: Tok[], file: string, server?: string): Invocation[] {
  const out: Invocation[] = [];
  for (let i = 0; i < toks.length; i++) {
    const m = PKG.exec(clean(toks[i].t));
    if (!m) continue;
    const rest: string[] = [];
    for (let j = i + 1; j < toks.length && !PKG.test(clean(toks[j].t)); j++) rest.push(clean(toks[j].t));
    out.push({
      file, line: toks[i].line, server, spec: m[1],
      url: rest.find(t => /^https?:\/\//i.test(t)),
      allowHttp: rest.includes('--allow-http'),
      deviceCode: rest.includes('--device-code'),
    });
  }
  return out;
}

/** Strip // and /* *\/ comments outside strings, and trailing commas (JSONC, as in .vscode/mcp.json). */
function jsonc(text: string): string {
  let out = '', inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) { out += c; if (c === '\\') { out += text[++i] ?? ''; } else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) { if (text[i] === '\n') out += '\n'; i++; } i++; continue; }
    out += c;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/** Structured read of an MCP client config: `mcpServers` (Claude/Cursor) or `servers` (VS Code). */
function fromConfig(doc: any, file: string, text: string, lineOffset: number): Invocation[] {
  const out: Invocation[] = [];
  const servers = { ...(doc && typeof doc.mcpServers === 'object' ? doc.mcpServers : {}), ...(doc && typeof doc.servers === 'object' ? doc.servers : {}) };
  for (const [name, s] of Object.entries<any>(servers)) {
    if (!s || typeof s !== 'object') continue;
    const argv = [
      ...(typeof s.command === 'string' ? s.command.split(/\s+/) : []),
      ...(Array.isArray(s.args) ? s.args.filter((a: unknown): a is string => typeof a === 'string') : []),
    ];
    const at = text.indexOf(JSON.stringify(name));
    const pkgAt = text.indexOf('mcp-remote', at < 0 ? 0 : at);
    const line = lineOffset + lineAt(text, pkgAt < 0 ? at : pkgAt);
    out.push(...fromTokens(argv.map(t => ({ t, line })), file, name));
  }
  return out;
}

/** Fenced code blocks only: prose that merely mentions a version is not an install instruction. */
function fromMarkdown(text: string, file: string): Invocation[] {
  const out: Invocation[] = [];
  const lines = text.split('\n');
  // Fences labelled as output show results, not commands to run.
  const OUTPUT_FENCE = /^(text|txt|output|log|plaintext)$/i;
  let fence: string | undefined, start = 0, buf: string[] = [], skip = false;
  const block = () => {
    const body = buf.join('\n');
    if (!body.includes('mcp-remote')) return;
    const trimmed = body.trim();
    const looksJson = trimmed.startsWith('{') || /"args"\s*:/.test(body);
    if (looksJson) {
      for (const candidate of [trimmed, `{${trimmed}}`]) {
        try { const doc = JSON.parse(jsonc(candidate)); const inv = fromConfig(doc, file, body, start - 1); if (inv.length) { out.push(...inv); return; } } catch { /* try next */ }
      }
      // Partial JSON: tokenize the whole block so args spread over lines stay together.
      out.push(...fromTokens(buf.flatMap((l, i) => l.split(/[\s,]+/).filter(Boolean).map(t => ({ t, line: start + i }))), file));
      return;
    }
    // Shell: one logical line per command (backslash / caret / backtick continuations joined).
    let cur: Tok[] = [];
    buf.forEach((l, i) => {
      const cont = /[\\^`]\s*$/.test(l);
      cur.push(...l.replace(/[\\^`]\s*$/, '').split(/\s+/).filter(Boolean).map(t => ({ t, line: start + i })));
      if (!cont) { out.push(...fromTokens(cur, file)); cur = []; }
    });
    if (cur.length) out.push(...fromTokens(cur, file));
  };
  lines.forEach((l, i) => {
    const f = /^\s*(```+|~~~+)\s*([\w+-]*)/.exec(l);
    if (f && !fence) { fence = f[1]; skip = OUTPUT_FENCE.test(f[2]); start = i + 2; buf = []; return; }
    if (f && fence && l.trim().startsWith(fence)) { if (!skip) block(); fence = undefined; return; }
    if (fence) buf.push(l);
  });
  return out;
}

function evaluate(inv: Invocation, strict: boolean): Result[] {
  const where = `${inv.file}:${inv.line}${inv.server ? ` (${inv.server})` : ''}`;
  const lvl = (l: Level): Level => (strict && l === 'warn' ? 'error' : l);
  const details = { file: inv.file, line: inv.line, server: inv.server, spec: inv.spec ?? null, url: inv.url ?? null, allowHttp: inv.allowHttp, deviceCode: inv.deviceCode };
  const out: Result[] = [];
  const v = inv.spec && EXACT.test(inv.spec) ? inv.spec : undefined;
  const deviceAdvisory = BRIDGE_ADVISORIES.find(a => a.gatedBy === '--device-code');
  let deviceCovered = false;

  if (!v) {
    out.push({ id: 'bridge-unpinned', level: 'info', details,
      message: `${where}: mcp-remote ${inv.spec ? `is pinned to "${inv.spec}" (a range or tag)` : 'is unpinned'}, so it can't be checked against known advisories offline; pin an exact version` });
  } else {
    for (const a of BRIDGE_ADVISORIES) {
      if (!inRange(v, a)) continue;
      const used = a.gatedBy === '--device-code' ? inv.deviceCode : !a.gatedBy;
      if (a.gatedBy === '--device-code') deviceCovered = true;
      const level: Level = a.gatedBy ? (used ? 'error' : 'warn') : 'error';
      const gate = a.gatedBy ? (used ? `; this invocation passes ${a.gatedBy}, so the vulnerable path is in use` : `; this invocation doesn't pass ${a.gatedBy}, so the vulnerable path isn't used as written`) : '';
      out.push({ id: a.rule, level: lvl(level), details: { ...details, cve: a.cve },
        message: `${where}: mcp-remote@${v} is in ${a.cve}'s affected range (${rangeText(a)}): ${a.summary}${gate} — ${a.advice}` });
    }
  }

  if (inv.deviceCode && !deviceCovered && deviceAdvisory && !deviceAdvisory.fixConfirmed) {
    out.push({ id: 'bridge-device-code', level: lvl('warn'), details,
      message: `${where}: passes --device-code; ${deviceAdvisory.cve} (${deviceAdvisory.summary}) has no confirmed upstream fix` +
        (v ? ` — mcp-remote@${v} is outside the advisory's listed range (unconfirmed upstream fix)` : ' and the pin can\'t be checked') +
        `; make sure the auth server's device-authorization and token endpoints are HTTPS` });
  }

  if (inv.allowHttp) {
    let u: URL | undefined;
    try { u = inv.url ? new URL(inv.url) : undefined; } catch { u = undefined; }
    if (!u) out.push({ id: 'bridge-allow-http', level: lvl('warn'), details,
      message: `${where}: passes --allow-http but the server URL couldn't be read; --allow-http lets OAuth tokens and MCP traffic go over cleartext HTTP to a non-loopback host` });
    else if (u.protocol === 'http:' && !LOOPBACK.has(u.hostname)) out.push({ id: 'bridge-allow-http', level: 'error', details,
      message: `${where}: --allow-http with non-loopback ${u.origin}: OAuth tokens and MCP traffic go over cleartext HTTP; use https://` });
    else out.push({ id: 'bridge-allow-http', level: 'ok', details,
      message: `${where}: --allow-http is present but unused (${u.protocol === 'https:' ? 'HTTPS' : 'loopback'} URL)` });
  }

  if (v && !out.some(r => r.level === 'error' || r.level === 'warn')) {
    const above = BRIDGE_ADVISORIES.filter(a => !a.fixConfirmed && cmp(v, a.to) > 0).map(a => a.cve);
    out.push({ id: 'bridge-pin', level: 'ok', details,
      message: `${where}: mcp-remote@${v} is outside the listed ranges of known advisories` +
        (above.length ? ` (${above.join(', ')}: outside the advisory's listed range (unconfirmed upstream fix))` : '') });
  }
  return out;
}

async function collect(root: string) {
  const out: { path: string; rel: string; kind: 'json' | 'md' }[] = [];
  async function walk(d: string): Promise<void> {
    if (out.length >= MAX_FILES) return;
    let entries;
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) await walk(full); continue; }
      if (!e.isFile()) continue;
      if (CONFIG_NAMES.has(e.name)) out.push({ path: full, rel: relative(root, full), kind: 'json' });
      else if (/\.mdx?$/i.test(e.name)) out.push({ path: full, rel: relative(root, full), kind: 'md' });
    }
  }
  await walk(root);
  return out;
}

export async function bridge(dir = '.', options: BridgeOptions = {}) {
  try {
    const st = await stat(dir).catch(() => undefined);
    if (!st?.isDirectory()) return unavailable('bridge', `Not a directory: ${dir}`);
    const strict = !!options.strict;
    const files = await collect(dir);
    const invocations: Invocation[] = [];
    const results: Result[] = [];
    for (const f of files) {
      let text: string;
      try { if ((await stat(f.path)).size > MAX_BYTES) continue; text = await readFile(f.path, 'utf8'); } catch { continue; }
      if (!text.includes('mcp-remote')) continue;
      if (f.kind === 'json') {
        let doc: unknown;
        try { doc = JSON.parse(jsonc(text)); } catch { results.push({ id: 'bridge', level: 'skip', message: `${f.rel}: not valid JSON, skipped` }); continue; }
        invocations.push(...fromConfig(doc, f.rel, text, 0));
      } else invocations.push(...fromMarkdown(text, f.rel));
    }
    for (const inv of invocations) results.push(...evaluate(inv, strict));
    const errors = results.filter(r => r.level === 'error').length;
    const warns = results.filter(r => r.level === 'warn').length;
    results.unshift({
      id: 'bridge',
      level: errors ? 'error' : warns ? 'warn' : 'ok',
      message: invocations.length
        ? `${files.length} config/Markdown file(s) scanned; ${invocations.length} mcp-remote invocation(s); ${errors} error(s), ${warns} warning(s)` + (strict ? ' — --strict: warnings are errors' : '')
        : `${files.length} config/Markdown file(s) scanned; no mcp-remote invocations found`,
    });
    return finish('bridge', results);
  } catch (e) {
    return unavailable('bridge', e instanceof Error ? e.message : String(e));
  }
}
