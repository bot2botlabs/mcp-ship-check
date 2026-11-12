import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { message } from '../project.js';
import { finish, unavailable, type Result, type Level } from '../report.js';
import { collect, stripComments } from './sinks.js';

export interface ReadonlyOptions { strict?: boolean }

/**
 * Read-only check: where does a SQL server's "read-only" promise actually live?
 *
 * For a server that talks to a SQL database AND claims read-only behaviour, it
 * looks for three kinds of evidence in the shipped JS/TS or Python source:
 *
 *  - database enforcement: a READ ONLY transaction or session, a read-only
 *    connection (`readonly: true`, `mode=ro`, `PRAGMA query_only`), or a
 *    read-only engine setting. The database then refuses writes however a
 *    statement is phrased.                                   → ok
 *  - a parser guard: a real SQL parser (node-sql-parser, sqlglot, …). Better
 *    than text checks, but still application-side.           → info
 *  - text guards only: `startsWith("SELECT")`, an anchored or alternated
 *    keyword regex, a keyword list. Multi-statement batches, data-modifying
 *    CTEs, `SELECT … INTO` and `EXPLAIN ANALYZE` walk past these. → warn
 *
 * It reports the SHAPE of the guard, never a vulnerability verdict, and it
 * can't see a read-only database role granted outside the code. Deterministic,
 * offline, executes nothing. `--strict` makes "text guards only" an error.
 */
export async function readonly(dir = '.', options: ReadonlyOptions = {}) {
  try {
    const strict = !!options.strict;
    const sources = await collect(dir);
    const ev: Evidence = { drivers: [], claims: [], guards: [], parsers: [], enforcement: [], multi: [] };
    let scanned = 0;
    for (const f of sources) {
      const raw = await readFile(f.path, 'utf8').catch(() => null);
      if (raw === null || raw.length > MAX_BYTES) continue;
      scanned++;
      scanSource(stripComments(raw, f.py), f.py, f.rel, ev);
    }
    for (const md of await readmes(dir)) {
      const text = await readFile(join(dir, md), 'utf8').catch(() => '');
      const at = firstMatch(text, README_CLAIM);
      if (at) ev.claims.push(`${md}:${at.line} ("${at.text}")`);
    }
    return finish('readonly', evaluate(ev, scanned, strict));
  } catch (e) { return unavailable('readonly', message(e)); }
}

// ── evidence ────────────────────────────────────────────────────────────────
interface Evidence {
  drivers: string[]; claims: string[]; guards: string[]; parsers: string[];
  enforcement: string[]; multi: string[];
}
const MAX_BYTES = 512 * 1024;
const MAX_LISTED = 8;

// SQL keywords a read-only guard tests for.
const KW = '(?:select|with|explain|show|describe|values|insert|update|delete|drop|alter|create|truncate|merge|replace|grant|revoke|call|exec(?:ute)?|pragma|attach|detach|copy|vacuum)';

// Database drivers and query layers. A repo that imports none isn't a SQL server.
const JS_DRIVER = /(?:from\s*|require\(\s*|import\(\s*|import\s+)['"](pg|postgres|@neondatabase\/serverless|@vercel\/postgres|mysql2?(?:\/promise)?|mariadb|mssql|tedious|better-sqlite3|sqlite3|sqlite|@libsql\/client|duckdb|@duckdb\/node-api|@clickhouse\/client|snowflake-sdk|@google-cloud\/bigquery|oracledb|@databricks\/sql|kysely|knex|drizzle-orm[\w/-]*|@prisma\/client|typeorm|sequelize|postgres-js)['"]/g;
const PY_DRIVER = /^\s*(?:import|from)\s+(psycopg2?|psycopg_pool|asyncpg|pymysql|MySQLdb|mysql\.connector|aiomysql|sqlite3|aiosqlite|duckdb|clickhouse_connect|clickhouse_driver|snowflake\.connector|google\.cloud\.bigquery|sqlalchemy|pyodbc|pymssql|oracledb|databricks\.sql|trino|pg8000)\b/gm;

// "This server is read-only" in code: config flags and mode names. MCP's
// `readOnlyHint` tool annotation is about the tool, not the database, so the
// trailing \b keeps it out.
const CODE_CLAIM = /\b(read_only|readOnly|READ_ONLY|isReadOnly|readOnlyMode|READONLY|READ_ONLY_MODE|allow_writes?|allowWrites?|ALLOW_WRITES?|enable_writes?|enableWrites?|ENABLE_WRITES?|write_enabled|writeEnabled|WRITE_ENABLED)\b/;
const README_CLAIM = /\bread[\s-]only\b(?!\s*hint)|\bselect[\s-]only\b|\bonly\s+select\b|\bno\s+writes\b/i;

// Keywords that only make sense as SQL. A list like ("create", "update") is
// usually REST or tool verbs, so lists and alternations need one of these.
const STRONG = /\b(?:select|insert|drop|alter|truncate|revoke|pragma|attach|detach|vacuum|explain|merge)\b/i;

// Text guards (application-side string inspection).
const GUARDS: [RegExp, string][] = [
  [new RegExp(`\\.(?:startsWith|startswith)\\(\\s*\\(?\\s*[rRbBuU]?['"\`]\\s*${KW}\\b`, 'gi'), 'prefix check'],
  [new RegExp(`\\^(?:\\\\s[*+]|\\s)*(?:\\(\\?:|\\()?\\s*${KW}\\b`, 'gi'), 'anchored keyword regex'],
  [new RegExp(`\\b${KW}\\b\\s*\\|\\s*(?:\\(\\?:)?\\s*\\b${KW}\\b`, 'gi'), 'keyword alternation'],
  [new RegExp(`[\\[({]\\s*[rRuU]?['"\`]${KW}['"\`]\\s*,\\s*[rRuU]?['"\`]${KW}['"\`]`, 'gi'), 'keyword list'],
];

// Real SQL parsers.
const JS_PARSER = /(?:from\s*|require\(\s*|import\s+)['"](node-sql-parser|pgsql-ast-parser|pgsql-parser|libpg-query|@pgsql\/[\w-]+|sql-parser-cst|dt-sql-parser|@guanmingchiu\/sqlparser-ts)['"]/g;
const PY_PARSER = /^\s*(?:import|from)\s+(sqlglot|sqlparse|mo_sql_parsing|pglast)\b/gm;

// Database-side enforcement. Case-sensitive where a loose match would hit
// TypeScript's own `readonly` keyword.
const ENFORCE: [RegExp, string][] = [
  [/\b(?:begin|start)\s+(?:transaction\s+)?read\s+only\b/gi, 'READ ONLY transaction'],
  [/\bset\s+(?:session\s+)?(?:characteristics\s+as\s+)?transaction\s+read\s+only\b/gi, 'SET TRANSACTION READ ONLY'],
  [/\b(?:default_transaction_read_only|transaction_read_only|tx_read_only)\b/gi, 'read-only session setting'],
  [/["']?\breadonly["']?\s*[:=]\s*(?:true|True|1|["']1["'])(?![\w])/g, 'read-only connection or setting'],
  [/\.read_only\s*=\s*True\b|\bpostgresql_readonly\s*=\s*True\b/g, 'read-only connection or setting'],
  [/[?&]mode=ro\b|\bSQLITE_OPEN_READONLY\b|\bOPEN_READONLY\b/g, 'read-only connection or setting'],
  [/\bPRAGMA\s+query_only\b/gi, 'PRAGMA query_only'],
  [/["'`]READ ONLY["'`]/g, 'READ ONLY transaction mode'],
  [/["']readonly["']\s*:\s*(?!false\b|False\b|0\b|None\b|null\b|undefined\b|["']0["'])[\w"']/g, 'read-only server setting'],
];
const MULTI = /\bmultipleStatements\s*:\s*true\b|\ballowMultiQueries\s*=\s*true\b/g;

function lineOf(code: string, idx: number): number {
  let n = 1;
  for (let i = 0; i < idx; i++) if (code.charCodeAt(i) === 10) n++;
  return n;
}
function firstMatch(text: string, re: RegExp): { line: number; text: string } | null {
  const m = re.exec(text);
  return m ? { line: lineOf(text, m.index), text: m[0].trim().slice(0, 40) } : null;
}
function each(code: string, re: RegExp, fn: (m: RegExpExecArray) => void) {
  re.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = re.exec(code)); ) { fn(m); if (m[0] === '') re.lastIndex++; }
}

function scanSource(code: string, py: boolean, rel: string, ev: Evidence) {
  each(code, py ? PY_DRIVER : JS_DRIVER, m => ev.drivers.push(`${m[1]} (${rel})`));
  const claim = firstMatch(code, CODE_CLAIM);
  if (claim) ev.claims.push(`${rel}:${claim.line} (${claim.text})`);
  for (const [re, kind] of GUARDS) each(code, re, m => (kind === 'prefix check' || kind === 'anchored keyword regex' || STRONG.test(m[0])) && ev.guards.push(`${rel}:${lineOf(code, m.index)} ${kind}: ${m[0].replace(/\s+/g, ' ').slice(0, 48)}`));
  each(code, py ? PY_PARSER : JS_PARSER, m => ev.parsers.push(`${m[1]} (${rel})`));
  for (const [re, kind] of ENFORCE) each(code, re, m => ev.enforcement.push(`${rel}:${lineOf(code, m.index)} ${kind}`));
  each(code, MULTI, m => ev.multi.push(`${rel}:${lineOf(code, m.index)}`));
}

async function readmes(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter(n => /^readme(\.[\w-]+)?\.md$/i.test(n));
  } catch { return []; }
}

const uniq = (xs: string[]) => [...new Set(xs)];
const list = (xs: string[]) => {
  const u = uniq(xs);
  return u.slice(0, MAX_LISTED).join('; ') + (u.length > MAX_LISTED ? `; +${u.length - MAX_LISTED} more` : '');
};
const dedupeLocations = (xs: string[]) => {
  // one entry per file:line, so overlapping guard patterns on one line count once
  const seen = new Map<string, string>();
  for (const x of xs) { const k = x.split(' ')[0]; if (!seen.has(k)) seen.set(k, x); }
  return [...seen.values()];
};

function evaluate(ev: Evidence, scanned: number, strict: boolean): Result[] {
  const guards = dedupeLocations(ev.guards);
  const details = {
    drivers: uniq(ev.drivers).slice(0, MAX_LISTED), claims: uniq(ev.claims).slice(0, MAX_LISTED),
    textGuards: guards, parsers: uniq(ev.parsers), enforcement: uniq(ev.enforcement), multipleStatements: uniq(ev.multi),
  };
  if (scanned === 0) return [{ id: 'readonly', level: 'skip', message: 'no runtime JS/TS or Python source found to scan' }];
  if (!ev.drivers.length) return [{ id: 'readonly', level: 'skip', message: `${scanned} source file(s); no SQL database driver imported, nothing to check` }];
  if (!ev.claims.length) return [{ id: 'readonly', level: 'info', message: `${scanned} source file(s); SQL driver found but no read-only claim, nothing to check`, details }];

  const out: Result[] = [];
  const multi = ev.multi.length ? ` Multi-statement queries are switched on (${list(ev.multi)}), so one request can carry a second statement.` : '';
  let level: Level; let id: string; let msg: string;
  if (ev.enforcement.length) {
    level = 'ok'; id = 'readonly-enforced';
    msg = `read-only is enforced in the database (${list(ev.enforcement)})` +
      (guards.length || ev.parsers.length ? '; application checks are defense in depth' : '') + '.';
    if (ev.multi.length) { msg += multi; level = 'info'; }
  } else if (ev.parsers.length) {
    level = 'info'; id = 'readonly-parser';
    msg = `read-only is checked by a SQL parser (${list(ev.parsers)}) but no database-side enforcement was found. ` +
      'Add a READ ONLY transaction or session, or a SELECT-only role, so the database refuses writes too.' + multi;
  } else if (guards.length) {
    level = strict ? 'error' : 'warn'; id = 'readonly-illusion';
    msg = `read-only rests on text checks only (${list(guards)}); no READ ONLY transaction, read-only session or read-only connection was found. ` +
      'Multi-statement batches, data-modifying CTEs, SELECT … INTO and EXPLAIN ANALYZE pass checks like these. ' +
      'Run reads in a READ ONLY transaction, one statement per call, under a SELECT-only role.' + multi +
      ' (A shape, not a verdict: a read-only role granted outside the code isn\'t visible here.)';
  } else {
    level = 'info'; id = 'readonly-unguarded';
    msg = 'claims read-only, but no read-only guard or enforcement was found in the code (it may rely on a database role or on which tools are enabled; check the docs).' + multi;
  }
  out.push({ id, level, message: msg, details });
  out.unshift({
    id: 'readonly',
    level: level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'ok',
    message: `${scanned} source file(s); read-only claim found (${list(ev.claims.slice(0, 2))})` +
      (level === 'warn' ? ' — review; a shape is not a vulnerability finding' : level === 'error' ? ' — --strict: text-only guard = error' : ''),
  });
  return out;
}
