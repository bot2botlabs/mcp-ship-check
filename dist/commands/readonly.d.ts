export interface ReadonlyOptions {
    strict?: boolean;
}
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
export declare function readonly(dir?: string, options?: ReadonlyOptions): Promise<import("../report.js").Outcome>;
