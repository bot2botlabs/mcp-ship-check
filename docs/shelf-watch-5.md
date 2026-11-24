# Shelf Watch #5: Your laptop isn't localhost — MCP HTTP binds, CORS, and DNS rebinding

## The short version

A lot of MCP servers ship twice: stdio for the client, plus an optional HTTP listener "for `mcp-remote` or debugging." On paper that endpoint is local. In code it often listens on **every network interface**, answers **any browser origin** with no login, or stands up **Streamable HTTP without DNS-rebinding protection** or **WebSocket without an Origin check**. Same failure family Shelf Watch #2 saw in its first transport findings — but the shelf grew, HTTP mode got more common, and the spec and SDK kept tightening what "local" is supposed to mean.

What actually protects a user is not the word *localhost* in the README. It's **where the socket binds**, **who CORS and Host/Origin let through**, and **whether the transport stack refuses cross-site callers by design.**

## Why it matters now

Bot2Bot Labs' daily MCP Registry archive counted **71,087 active servers** on **2026-11-24** (00:00 UTC snapshot) — **14,181 more active entries than on 2026-11-06**, when the series started. In the last seven days alone the registry added **6,882** new server names (321 removed the same week). **48,890** active entries expose a hosted remote URL; **36.9%** of active entries still ship with **no source-repository link**, so HTTP-mode claims are hard to verify from the outside.

We re-ran the same read-only evidence pass the archive publishes (`audit_scan.py` on that day's `latest` + `tools` + `signals-state` files). On **2026-11-24** it found **22.1%** of tools in the hosted probe sample (**1,491 of 6,745**) still carry **no `readOnlyHint` / `destructiveHint`**, down from **31%** in our November baseline report but still nearly one tool in four. Among GitHub repos the rolling signals have checked (**13,601** repos in state), **11.9%** now return **404**.

Against that backdrop we extended the transport rules in [`mcp-ship-check`](https://github.com/bot2botlabs/mcp-ship-check) through **v0.9.2** (CORS without auth, bind-host shapes, DNS-rebinding flag gaps, WebSocket upgrade checks; cf. CVE-2026-59950) and **re-scanned fresh code** two ways on **2026-11-24**:

1. **Batch-10 slice (self-hosted / HTTP-shaped servers outside our existing audit ledger, selected from the 2026-11-22 snapshot):** **232** GitHub repos cloned and scanned with `sinks` v0.9.2. **50** had at least one transport-related line; **14** had **risky transport shapes** (default `warn` — review targets, not verdicts). Message themes in those 14: **9** all-interface or omitted bind-host shapes, **14** missing `enableDnsRebindingProtection` or equivalent (some servers had both).
2. **Same-day registry additions:** **90** servers **newly listed on 2026-11-24** with a package and GitHub repo outside the ledger — **1** showed risky transport shapes in the same static scan (**wildcard CORS plus explicit `0.0.0.0` bind** in an HTTP entrypoint). Fresh listings are where this pattern still shows up often; we are not treating a scanner line as a vulnerability finding.

Across our cumulative coordinated-disclosure work through **2026-11-24**, **12 of 32** confirmed code-level findings involve **self-hosted HTTP transport exposure** (class-level count; no maintainer names in this issue).

---

## Three ways "local HTTP" stops being local

### 1. The listener is on `0.0.0.0` (or the bind host is omitted)

**The pattern.** Node's `server.listen(port, callback)` and Express-style `app.listen(port)` default the bind host to **all interfaces**. Python `uvicorn.run(..., host="0.0.0.0")` and FastMCP defaults do the same. The README still says "open `http://localhost:…`."

**What it breaks.** Anything on the LAN can call the MCP HTTP surface. If the tools move money, read mail, or run shell commands, the LAN is in scope — not just the developer's browser profile.

**The shape we see.** A `listen` call whose second argument is already the request handler (no host string), or an explicit `'0.0.0.0'` / `'::'`.

### 2. Wildcard CORS without caller authentication

**The pattern.** `cors()` with default options, `origin: true`, `origin: '*'`, or a manual `Access-Control-Allow-Origin: *` on the MCP route — while **no** bearer, session, or OAuth gate runs on that route in the same file.

**What it breaks.** DNS-rebinding tricks are not required. Any website the user visits in a normal browser session can issue cross-origin requests to the user's MCP port and **read JSON responses** (MCP Streamable HTTP is not a simple "fire-and-forget" POST). Authentication middleware that only runs when an environment variable is set does not count; commented-out auth does not count.

### 3. Streamable HTTP or WebSocket without Host/Origin discipline

**The pattern (HTTP).** `new StreamableHTTPServerTransport({...})` without `enableDnsRebindingProtection: true`, and no in-file Host/Origin allowlist, while the listener is reachable beyond loopback (or uses the default bind).

**The pattern (WebSocket).** `websocket_server()` / `ws.accept()` or `new WebSocketServer` / `handleUpgrade` with no `TransportSecuritySettings`, `verifyClient`, or Origin allowlist — the MCP SDK's HTTP middleware never runs on the upgrade.

**What it breaks.** A malicious page can reach a loopback MCP port via DNS rebinding (HTTP) or cross-site WebSocket hijacking (WS): initialize, `tools/list`, call tools, exfiltrate results — still no shell on the attacker server, but full use of whatever the local MCP server can do.

---

## What actually holds the line

One rule covers all three: **treat the HTTP surface like a networked API, not like stdio.**

1. **Bind loopback by default.** `127.0.0.1` / `localhost` / `::1`, or a Unix socket. If you intentionally expose the LAN or internet, document it and require authentication on every route.
2. **Authenticate callers** (bearer token, OAuth, mTLS) on the MCP HTTP path — not only on a separate admin UI.
3. **Restrict CORS** to origins you operate, or skip CORS entirely for localhost-only binds that only the desktop client uses.
4. **Turn on SDK DNS-rebinding protection** (`enableDnsRebindingProtection: true` with explicit `allowedHosts` / `allowedOrigins`) for Streamable HTTP, and apply the same Host/Origin checks to WebSocket upgrades (Python `TransportSecuritySettings`, JS `verifyClient`).
5. **Reject "is loopback?" tests by substring** (`clientIp.includes("::1")`). Normalize the address; `fe80::1a2b` is not local.

The servers that looked careful in our batches shared a pattern: loopback default, fail-closed if a token is missing, narrow CORS, and loud startup warnings when HTTP mode is wide open.

---

## A one-line test

> If a user visits a random website while your MCP HTTP server is running, can that page initialize a session and read tool results without a token?
>
> If yes, your transport is not local — fix bind, CORS, and Host/Origin before you ship HTTP mode.

## A free check (offline)

Transport rules ship in the existing `sinks` command (v0.5.0 through v0.9.2). It is deterministic, offline, and reads only source:

```bash
npx github:bot2botlabs/mcp-ship-check sinks . 
```

Add `--strict` to promote risky shapes to errors in CI. Example on the fixture we ship for wildcard CORS (v0.9.2):

```text
⚠ sinks: 2 source file(s); 1 risky sink shape(s), 1 safe sink(s) — review; a shape is not a vulnerability finding
⚠ transport: app.ts:5 — CORS allows every origin on an MCP HTTP server and this file applies no authentication — any website the user visits can call the server and read its replies; restrict origins to the ones you serve, or require a token
✔ transport: handler.ts:3 — StreamableHTTPServerTransport with enableDnsRebindingProtection: true
PASS (3 checks)
```

It reports **shapes, not verdicts**: bearer auth defined in another file, or a reverse proxy enforcing Origin, is not visible to a source scan. If you have those, a warning is a prompt to document them — not an accusation.

---

## How we measured (2026-11-24)

| Number | Source |
|---|---|
| 71,087 active registry servers; 1,099 non-active excluded | `mcp-shelf-archive` release `snapshot-2026-11-24`, `audit_scan.py` on `latest-2026-11-24.jsonl.gz` |
| +14,181 active vs 2026-11-06; +6,882 / −321 server names in the last 7 days | `mcp-shelf-archive/stats/daily.csv` |
| 48,890 with remotes; 36.9% active with no source link | same snapshot + `daily.csv` row 2026-11-24 |
| 22.1% tools without readOnly/destructive hints (1,491 / 6,745); 549 probed / 374 answered | `audit_scan.py` on `tools-2026-11-24T0013Z.jsonl.gz` |
| 11.9% GitHub repos 404 (1,623 / 13,601 checked) | `audit_scan.py` on `signals-state.json.gz` |
| 232 repos scanned; 50 with transport lines; 14 with risky transport shapes; theme counts | `mcp-ship-check` v0.9.2 `sinks --json`, batch-10 candidate list (`distribution-research/lab/data/batch10-candidates-v1.json`), clones 2026-11-24 |
| 90 newly listed servers scanned; 1 risky transport shape | `sinks` v0.9.2 on 2026-11-24 diff additions with package + GitHub repo outside ledger |
| 12 / 32 transport-class confirmed findings (no names) | `mcp-audit-queue` `audit-queue/STATE.md` + `distribution-research/lab/data/scanned-repos-v1.json` verdict counts, read 2026-11-24 |

Registry and archive: public MCP Registry API snapshots in [`bot2botlabs/mcp-shelf-archive`](https://github.com/bot2botlabs/mcp-shelf-archive). Code scans: static only — no server was installed, run, or called.

---

*Shelf Watch is Bot2Bot Labs' series on what's actually on the MCP shelf. The free, offline scanner we use for these audits is [`mcp-ship-check`](https://github.com/bot2botlabs/mcp-ship-check).*

*New, separate from this report: **MCP Monitor**. If you own or deploy an MCP server, it re-runs checks like these on every release you ship and emails you when something new turns up. It also alerts you when a published MCP SDK advisory hits a version you pin. Paid plans aren't open yet; the waitlist is at [bot2botlabs.com/monitor](https://bot2botlabs.com/monitor) (no card). `mcp-ship-check` stays free, and so does our disclosure work with other projects' maintainers: same clock whether or not anyone pays, never a pitch, and paying never buys earlier details about anyone else's code.*

*Earlier issues: [#2, code-level sinks across 194 servers](https://github.com/bot2botlabs/mcp-ship-check/blob/main/docs/shelf-watch-2.md) · [#3, what good looks like on a hosted enterprise MCP server](https://github.com/bot2botlabs/mcp-ship-check/blob/main/docs/shelf-watch-3.md) · [#4, read-only enforcement on database and cloud servers](https://github.com/bot2botlabs/mcp-ship-check/blob/main/docs/shelf-watch-4.md).*

*Bot2Bot Labs keeps a daily, public-data archive of the MCP shelf. This is the fifth in a series on what's actually out there.*