# Shelf Watch #4: Read-only by default, writable by accident: where MCP database and cloud servers enforce "read-only"

## The short version

A growing number of MCP servers put a database or a cloud CLI in front of an AI agent and promise the risky half is off: *"read-only by default"*, *"no writes unless you opt in"*, *"safe to explore"*. For a CFO approving an agent that can see the general ledger, or a DBA letting one read production, that sentence is the whole risk model.

What decides whether the promise holds is **where** it's enforced. Across 300 MCP servers whose code we read, the ones that hold the line enforce read-only at the database transaction, the database role, or the cloud credential, all layers that refuse a write no matter how it's phrased. The ones that break enforce it in the *application*, by inspecting the SQL text or the CLI verb before running it. That's a denylist written against a language the server doesn't control, and the language always has another way to say "write".

## Why it matters now

Of the 10 servers in our audit with a verified code-level vulnerability, **3 were read-only promises their own code didn't keep**. That's as many as unauthenticated network transports (3), and second only to command injection (4). They're quietly dangerous because nothing looks broken: the demo reads a table, the happy path works, and the write only happens when an agent (or a prompt injected into data the agent reads) phrases a request the filter didn't anticipate. The operator was told the tool couldn't do that.

---

## Three ways application-layer "read-only" fails

### 1. One request, several statements

**The pattern.** The guard checks that the text *begins* like a read, then hands the whole text to a database driver that executes every statement it contains.

```text
request text:  <read statement> ; <second statement>
guard sees:    a read statement at the start  → allowed
driver runs:   both statements, in order
```

**Why it happens.** Many drivers execute multi-statement text when a query is sent without bind parameters (PostgreSQL's simple query protocol; options like MySQL's `multipleStatements`). That is exactly the path a string-checking guard tends to use. Hand-written "is there a second statement?" checks also tend to get string-literal and comment rules subtly wrong, so a separator can hide from the check while the database still sees it.

**What it breaks.** Everything after the first statement runs with the agent's full database privileges, including a statement that ends the transaction the guard thought it was inside.

### 2. A single statement that starts like a read but writes

Even when only one statement is allowed, "starts with a read keyword" is not the same as "is a read". Several standard SQL forms begin with `SELECT`, `WITH` or `EXPLAIN` and still change data:

| Statement form | Starts with | What actually happens |
|---|---|---|
| Data-modifying common table expression | `WITH` | The `WITH` block contains an `INSERT`/`UPDATE`/`DELETE … RETURNING`; PostgreSQL executes it, then the outer `SELECT` reads the returned rows. |
| `SELECT … INTO <new table>` | `SELECT` | Creates and fills a new table. |
| `EXPLAIN ANALYZE <statement>` | `EXPLAIN` | `ANALYZE` *executes* the statement to time it. In PostgreSQL that includes data-changing statements. |
| Commands missing from the denylist | various | Refreshing materialized views, changing object ownership, preparing and then executing a stored statement: all writes, none on a short "INSERT/UPDATE/DELETE/DROP" list. |

The `EXPLAIN` case is the sharpest, because operators reach for an "explain this query" tool precisely *because* they believe it's harmless. A guard that lets every `EXPLAIN` through lets through whatever it's explaining.

### 3. Verb denylists in cloud-CLI servers

Cloud-admin MCP servers that wrap a CLI often decide "read or write?" from the operation name: anything starting with `create-`, `delete-`, `put-`, `update-` and so on counts as a write, and everything else is allowed. A CLI with thousands of operations defeats that in three structural ways:

- **Writes whose verb isn't on the list.** Operations named with verbs like *invoke*, *deploy*, *subscribe* or *execute* change state but don't start with any "mutating" prefix.
- **Writes to the user's own machine.** A CLI's configuration subcommands rewrite its local config files. Those files can name a *credential helper*, a program the CLI runs whenever it needs credentials, so a config change made through a "read-only" tool can become a program that runs on the next call.
- **Reads that write locally.** Some download-style operations take a local output path and write the response there.

Same root cause as the database case: the safe set was defined by *excluding* known-bad names instead of *including* known-safe ones.

---

## The fix: let the layer that can refuse do the refusing

One rule covers all three: **enforce read-only where a write is rejected unconditionally (the database transaction, the database role, the cloud credential), not where it can only be guessed from text.** Application checks are still worth having, as a second line and for clear error messages, but never as the guarantee.

### Databases (PostgreSQL, MySQL and similar)

1. **Run every read inside a read-only transaction, and always roll it back.** `BEGIN READ ONLY` in PostgreSQL, `START TRANSACTION READ ONLY` in MySQL. The engine then refuses writes, DDL and data-modifying CTEs however they're phrased, which closes failures 1 and 2 at the source. For pooled connections, `default_transaction_read_only = on` applies the same rule session-wide.

   ```js
   // The shape that holds (node-postgres)
   await client.query("BEGIN READ ONLY");
   try {
     return await client.query({ text: sql, values: params, queryMode: "extended" });
   } finally {
     await client.query("ROLLBACK");
   }
   ```

2. **Send one statement per call, as a prepared/extended-protocol query.** The extended protocol accepts exactly one statement, so failure 1 can't smuggle in a second one, and nothing can end the read-only transaction early. Pass user values as bind parameters; never concatenate them.

3. **Give the agent a database role that can only read.** Grant `SELECT` on what it needs and nothing else, or set `default_transaction_read_only` on the role itself. This backstop survives a bug in everything above, including server-side functions that have side effects even inside a read-only transaction. If you only do one thing, do this.

4. **If you parse, use a real SQL parser and allowlist statement types.** Allow `SELECT`, `SHOW` and plain `EXPLAIN` (not `EXPLAIN ANALYZE`), and explicitly reject multiple statements, `INTO`, and data-modifying CTEs. Comments and formatting disappear once the syntax tree is built; they don't in a prefix match.

### Cloud CLIs (AWS, GCP, Azure and similar)

1. **Allowlist read operations; treat everything else as a write.** Permit operations known to be reads (`describe-…`, `list-…`, `get-…` without a local output path, and so on) and send everything else down the write path that needs explicit opt-in. New operations then default to *blocked*.
2. **Enforce it at the credential.** Run the connector under a read-only IAM role or policy. Then a missed verb fails at the cloud API, the same way a `SELECT`-only role saves the database case. The wrapper's allowlist becomes defense in depth.
3. **Treat local config writes as writes.** Configuration subcommands, credential-file edits and any operation that writes a caller-chosen local path change the host. Gate them like any other write.

---

## What "good" looked like in our audit

The servers that held up shared a pattern: a fresh connection per call, a read-only transaction around it, one prepared statement at a time, a refusal to run as a superuser, and a documented recommendation to connect with a `SELECT`-only role. The best cloud-CLI design we saw paired an operation allowlist with a read-only credential. None of them relied on a prefix check as the guarantee.

We hold ourselves to *fixing*, not just finding. Our first fully coordinated disclosure, `atlas-mcp-server` (CWE-78), was fixed by its maintainer in **v1.0.30** and published as **[GHSA-w3gh-28jp-2hmv](https://github.com/IamNishant51/atlas-mcp-server/security/advisories/GHSA-w3gh-28jp-2hmv)**. The read-only findings from this audit are in coordinated disclosure now, and as with every Shelf Watch, we name a project only after its fix is public.

## A one-line test for your own server

> If you deleted every string check in your "read-only" code path, could the agent still not write?
> If the answer is "it could", your read-only mode lives in the application. Move it to the transaction and the role.

## A free check, so you can see the shape yourself

We turned that question into a pre-ship check, in [`mcp-ship-check`](https://github.com/bot2botlabs/mcp-ship-check) v0.4.0. It's deterministic, offline, reads only your source, and never connects to a database:

```bash
npx github:bot2botlabs/mcp-ship-check readonly .
```

It only runs when the server imports a SQL driver or query layer **and** the README or code claims read-only. MCP's `readOnlyHint` tool annotation doesn't count on its own. Then it reports what it found, strongest first:

- **ok** (`readonly-enforced`): the database enforces it — a `READ ONLY` transaction, a read-only session or connection, or a server `readonly` setting. Text checks alongside are defense in depth.
- **info** (`readonly-parser`): a real SQL parser guards it, but nothing database-side was found.
- **warn** (`readonly-illusion`, error with `--strict`): only text checks guard it, with file:line for each.
- **info** (`readonly-unguarded`): claims read-only, but no guard or enforcement was found in the code; it may rely on a database role or on which tools are enabled.

It reports **a shape, not a verdict**: a SELECT-only database role granted outside the code isn't visible to a source scan. If you have one, a `readonly-illusion` result is a prompt to document it.

Here's what it prints on a sample server whose only guard is a prefix check and a keyword regex (the fixture shipped with v0.4.0):

```text
⚠ readonly: 1 source file(s); read-only claim found (README.md:2 ("read-only")) — review; a shape is not a vulnerability finding
⚠ readonly-illusion: read-only rests on text checks only (src/index.ts:6 prefix check: .startsWith('select; src/index.ts:3 anchored keyword regex: ^\s*(INSERT); no READ ONLY transaction, read-only session or read-only connection was found. Multi-statement batches, data-modifying CTEs, SELECT … INTO and EXPLAIN ANALYZE pass checks like these. Run reads in a READ ONLY transaction, one statement per call, under a SELECT-only role. (A shape, not a verdict: a read-only role granted outside the code isn't visible here.)
PASS (2 checks)
```

By default it only warns, so it won't break your CI; add `--strict` to make a text-only guard fail the build (exit code 1). The same check runs as a GitHub Action:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 20
- uses: bot2botlabs/mcp-ship-check@main
  with:
    command: readonly
    args: --strict
```

This check covers SQL servers. Cloud-CLI verb denylists (failure 3 above) aren't in its scope: for those, the credential-side allowlist in the Cloud CLIs section is the equivalent test. Run it on your server before you publish. If it's wrong about yours, open an issue or send a PR; we'd rather fix the check than cry wolf.

---

*Shelf Watch is Bot2Bot Labs' series on what's actually on the MCP shelf. The free, offline scanner we use for these audits is [`mcp-ship-check`](https://github.com/bot2botlabs/mcp-ship-check). Earlier issues: [#2, code-level sinks across 194 servers](https://github.com/bot2botlabs/mcp-ship-check/blob/main/docs/shelf-watch-2.md) · [#3, what good looks like on a hosted enterprise MCP server](https://github.com/bot2botlabs/mcp-ship-check/blob/main/docs/shelf-watch-3.md).*

*Bot2Bot Labs keeps a daily, public-data archive of the MCP shelf. This is the fourth in a series on what's actually out there.*
