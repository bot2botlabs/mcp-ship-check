# Dogfood

- **Date:** Nov 2, 2026 (PT)
- **CLI:** `mcp-ship-check` 0.1.0 at commit `db6a00a` (branch `claude/dogfood`), built with `npm ci && npm run build`, run as `node dist/cli.js` (written `msc` below)
- **Targets:** fresh clones in `~/Projects/.worktrees/msc-dogfood/`, each fast-forwarded with `git pull -q --ff-only` before checking
- **Ground rules:** read-only. Nothing published, nothing pushed, no tracked target files edited. Placeholder credentials are recorded wherever they were used.

Exit codes: `0` = PASS, `1` = FAIL, `2` = COULD NOT RUN.

---

## deadline-desk (`origin/main` @ `a7d7229`)

The MCP package is `packages/mcp` (`@deadline-desk/mcp` 0.1.0, `publishConfig.access: public`). Its stdio entry point is `src/cli.ts` (which uses `StdioServerTransport`), built to `dist/cli.js`. The package has no `bin`, no `manifest.json` and no `server.json`. Setup: root `npm ci`, then `npm run build -w @deadline-desk/{core,trace,mcp}`.

| Command | Exit |
|---|---|
| `msc files packages/mcp --json` | 0 |
| `msc files packages/mcp` | 0 |
| `msc files .` (repo root, for comparison) | 0 |
| `msc tools packages/mcp --cmd "node dist/cli.js"` | 0 |
| `msc tools packages/mcp --cmd "node dist/cli.js" --json` | 0 |
| `msc tools packages/mcp` (no `--cmd`) | 2 |
| `msc published packages/mcp` / `--json` | 0 |

Error/warn lines, verbatim:

```
⚠ manifest tools: manifest declares no tools
✖ tools: Provide --cmd "node dist/index.js" or manifest.json server.mcp_config      (no --cmd run; expected)
⚠ npm: not on npm
```

Other output: `✔ live tools: 2 tools: lookup_policy, get_receipt`. The `files` command only produced two `skip` lines (`manifest.json missing (optional)`, `server.json missing (optional)`) and still printed `PASS (2 checks)`.

**Real mismatches found**
- None in the metadata. The live tools (`lookup_policy`, `get_receipt`) match the names in `packages/mcp/README.md`. I checked that by hand because the tool can't compare README names without a manifest.
- Readiness note, not drift: `@deadline-desk/mcp` is not on npm even though it is marked public. It also has no `bin`, so once published, `npx @deadline-desk/mcp` would not start the stdio server.

## loop-desk (`origin/main` @ `b315dd7`)

This is a Next.js app that serves MCP only over Streamable HTTP (`src/app/mcp/route.ts`). There is no stdio entry point and no manifest or server.json.

| Command | Exit |
|---|---|
| `msc files . --json` / `msc files .` | 0 / 0 |
| `timeout 60 msc tools . --cmd "npx -y mcp-remote https://loop.bot2botlabs.com/mcp" --timeout 50000` | 2 |

Error/warn lines, verbatim (stderr as the tool printed it: the last 2 KB, starting mid-word):

```
✖ tools: MCP server exited (1); stderr: nection error: TypeError: fetch failed
    at Object.processResponse (.../node_modules/undici/lib/web/fetch/index.js:237:16)
    ...
  [cause]: Error: read ECONNRESET
      at TLSWrap.onStreamRead (node:internal/stream_base_commons:221:20) {
    errno: -54,
    code: 'ECONNRESET',
    syscall: 'read'
  }
[59716] Fatal error: TypeError: fetch failed
```

`curl https://loop.bot2botlabs.com/.well-known/mcp.json` from the same environment also got `Connection reset by peer`, while `registry.npmjs.org` returned 200. The reset comes from this environment's network, not from the server or from mcp-remote. I did not retry outside the sandbox.

**Result: not checkable in v1 (HTTP transport).** In this environment it was also unreachable over the network.

**Real mismatches found**
- None detectable. From source, the tools are `register_loop`, `get_loop` and `list_due`. `README.md` doesn't name any MCP tools, and `/.well-known/mcp.json` doesn't list them either, so there is nothing to drift against. That is a documentation gap, not drift.

## warranty-desk (`origin/main` @ `0909eaf`)

This is a Next.js app with a Streamable HTTP `/mcp` route only. Its public URL, `https://warranty.bot2botlabs.com/mcp`, comes from the README and docs.

| Command | Exit |
|---|---|
| `msc files . --json` / `msc files .` | 0 / 0 |
| `timeout 60 msc tools . --cmd "npx -y mcp-remote https://warranty.bot2botlabs.com/mcp" --timeout 50000` | 2 |

Error/warn lines, verbatim: the same as loop-desk (`✖ tools: MCP server exited (1); stderr: nection error: TypeError: fetch failed ... read ECONNRESET ... [59740] Fatal error: TypeError: fetch failed`). `curl` to `warranty.bot2botlabs.com` was also reset.

**Result: not checkable in v1 (HTTP transport)**, and unreachable from this environment.

**Real mismatches found**
- None found. Checked by hand: the tools in `src/app/mcp/route.ts` (`check_warranty`, `get_warranty_receipt`) match `README.md` and the `tools` array in `/.well-known/mcp.json/route.ts`.

## qbo: bot2botlabs/quickbooks-online-mcp-server (`feat/mcpb-bundle-23` @ `c75b1e3`)

The package is at the repo root (`@qboapi/qbo-mcp-server` 0.0.1). Its MCPB `manifest.json` (v0.4) sets `server.mcp_config` = `node ${__dirname}/dist/index.js`. Setup: `npm ci` (the `prepare` script builds `dist/`).

Placeholder credentials used: `QUICKBOOKS_CLIENT_ID=fake QUICKBOOKS_CLIENT_SECRET=fake QUICKBOOKS_REFRESH_TOKEN=fake QUICKBOOKS_REALM_ID=fake QUICKBOOKS_ENVIRONMENT=sandbox`. I also set `QUICKBOOKS_TOKEN_STORE_PATH=/tmp/qbo-fake/tokens.env`, an empty temp file, so the server would not create a `.env` inside the clone.

| Command | Exit |
|---|---|
| `msc files . --json` / `msc files .` | 0 / 0 |
| `msc tools .` (manifest `mcp_config`, no env) | 2 |
| `msc tools . --env <fake placeholders above>` | 0 |
| `msc tools . --env <fake placeholders above> --json` | 0 |
| `msc published .` / `--json` | 0 |

Error/warn lines, verbatim:

```
⚠ name: package.json @qboapi/qbo-mcp-server, manifest.json quickbooks-online
✖ tools: MCP server exited (0); stderr: [auth-server] uncaughtException: Error: Client ID, Client Secret and Redirect URI must be set in environment variables
    at file:///.../qbo/dist/clients/quickbooks-client.js:53:11
⚠ README tools: README.md missing manifest.json tools: create_account, create_employee, create_estimate, create_item, create_journal_entry, create-bill, create-vendor, delete_employee, delete_estimate, delete_item, delete_journal_entry, delete-bill, delete-vendor, get_account, get_employee, get_estimate, get_journal_entry, get_vendor_balance, get-bill, get-vendor, read_invoice, read_item, search_accounts, search_budgets, search_employees, search_estimates, search_items, search_journal_entries, search_purchases, update_account, update_employee, update_estimate, update_item, update_journal_entry, update-bill, update-vendor
⚠ npm: not on npm
– glama: could not check: HTTP 401
```

Other output:
- `✔ version: package.json 0.0.1 = manifest.json 0.0.1`
- `✔ live tools: 142 tools: create_customer, ...`
- No `manifest.json tool X missing from live tools` errors, no `Live tool X missing from manifest.json` errors and no description warnings. All 142 manifest tools match the live server exactly, names and descriptions.

**Real mismatches found**
- **The README tool count is stale.** `README.md` says "**145 Total Tools**" and has a `Tools-145` badge, but the live server registers **142**. The tool **did not flag this** (see the gaps below).
- **The README uses the wrong names for 8 tools.** The live/manifest names are hyphenated (`create-bill`, `update-bill`, `delete-bill`, `get-bill`, `create-vendor`, `update-vendor`, `delete-vendor`, `get-vendor`). The README Tool Reference documents them as `create_bill`, `get_vendor` and so on.
- **The README documents tools that don't exist.** `get_invoice` (live: `read_invoice`) and `get_aged_receivables_detail` (no such live tool).
- **The README has no per-tool rows for several tools.** Account, Employee, Estimate, Item and Journal Entry, plus `get_vendor_balance`, `search_budgets` and `search_purchases`, appear only as ✅ cells in the summary entity table. Some of the 36 names in the `README tools` warning are this kind of coverage-by-table rather than drift.
- **The live tool names mix conventions.** 8 tools are kebab-case and the other 134 are snake_case. This is a design inconsistency in the upstream server, not file drift.
- **Name differs between package.json and manifest.json.** `@qboapi/qbo-mcp-server` vs `quickbooks-online`. This is intentional: the MCPB bundle has its own display name. Harmless.
- Side observation: when credentials are missing, the server crashes with an uncaught exception but **exits with code 0**.

---

## False positives / tool gaps

1. **The `files` command reports PASS when it checked nothing.** For deadline-desk, loop-desk and warranty-desk, every result was a `skip`, yet it printed `PASS (2 checks)` and exited 0. "Nothing to compare" is indistinguishable from "all consistent".
2. **`tools` warns "manifest declares no tools" when there is no manifest.json.** On deadline-desk the warning is misleading: there is nothing to declare tools in. It should be a `skip` ("manifest.json missing").
3. **The README tool-name check only works when a manifest exists.** It only looks for manifest names in the README. With no manifest (deadline-desk) it compares live tools against nothing, even though the README names them.
4. **The README tool-name check only runs one way.** It never reports README-documented names that don't exist live. On qbo it missed `create_bill`, `get_bill`, `create_vendor`, `get_vendor`, `update_*`/`delete_*` bill/vendor, `get_invoice` and `get_aged_receivables_detail`.
5. **The README count regex misses common phrasings.** `(\d+)\s+tools\b` doesn't match "145 Total Tools" or the `Tools-145` shields badge, so qbo's stale count (145 vs 142 live) went unflagged.
6. **The README tool-name check is noisy for table-style READMEs.** On qbo, many of the 36 "missing" names are covered by the entity CRUD summary table (✅ cells). It's a defensible warning, but very noisy for upstream-style READMEs.
7. **The Glama check always fails.** `https://glama.ai/api/mcp/v1/servers/<owner>/<repo>` returns HTTP 401 without auth (the HTML page `glama.ai/mcp/servers/<owner>/<repo>` returns 200), so the check is effectively always `skip: could not check: HTTP 401`.
8. **The stderr tail starts mid-word.** It is truncated to the last 2048 chars (`nection error: ...`), so the first line, which is usually the most useful, is lost on long stack traces.
9. **HTTP-only servers can't be checked directly.** This was already known (KNOWN-EDGES: "HTTP and alternative transports"). The `mcp-remote` bridge workaround depends on outbound network access, which this environment did not have.
