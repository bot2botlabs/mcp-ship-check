export interface SinksOptions {
    strict?: boolean;
}
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
 * v2.7: (1) `exec` matching already excludes a member-access call (`db.exec(`,
 * `regex.exec(`) via a `(?<![.\w$])` lookbehind, so a child_process binding in
 * scope no longer turns a DuckDB/RegExp `.exec` into a finding; the namespace
 * form (`cp.exec(`) is still flagged by its own matcher. (2) the Python
 * `transport` check now also inspects `FastMCP(host=...)` and recognises a host
 * bound to `0.0.0.0`/`::` via an `os.getenv(..., "0.0.0.0")` default fallback,
 * not just a direct literal.
 */
export declare function sinks(dir?: string, options?: SinksOptions): Promise<import("../report.js").Outcome>;
export declare function collect(dir: string): Promise<{
    path: string;
    rel: string;
    py: boolean;
}[]>;
export declare function stripComments(src: string, py: boolean): string;
