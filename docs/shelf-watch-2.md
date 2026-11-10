# Shelf Watch #2: What we found auditing 194 MCP servers for code-level sinks

Building an MCP server is nearly free now. The scarce thing is trust: with thousands of servers on the shelf, which ones are safe to plug into an agent that can read your files and run your tools?

We kept a daily record of the official MCP Registry — **58,928 active servers** on the day we measured — and it shows how hard that question is to answer from the outside:

- **34.6%** list no source repository at all — nothing to read before you install.
- **33.9%** of the tools we could inspect declare no `readOnly`/`destructive` safety annotation.
- **~19%** of the source repos we sampled return a 404 — the code behind the server is already gone.

Stats only go so far, so we read the code. We built a small, read-only static check and **hand-audited 194 unique servers** — general-purpose ones, and a focused slice of the riskiest archetype: CLI, shell, Git/Docker/Kubernetes and database wrappers, where untrusted input most often meets a dangerous sink.

## What "safe" looks like

The best servers we read were genuinely careful. Three patterns are worth copying:

1. **Guarded SQL over an isolated engine.** One server never sends a model-supplied query upstream. It loads a bounded snapshot into an **in-memory SQLite** and runs the query there behind a `sqlglot` parse (one table, no joins/subqueries/CTEs), a deny-by-default SQLite authorizer, `query_only=ON`, and step/row/byte caps. The user can ask anything; nothing can escape the sandbox.
2. **A `realpath` + base-prefix + argv media wrapper.** A video tool resolves every input path with `realpath`, rejects `..`, symlinks, system directories and anything outside an allowlist, and runs FFmpeg with an **argument array — never a shell string**. The result: it does exactly what you ask and nothing you didn't.
3. **argv discipline + parameterized SQL in a process supervisor.** A coding-agent supervisor spawns everything with `execFile`/`spawn` and argument arrays (no shell), runs `git` with fixed subcommands, and binds every value with `?` placeholders. No interpolation anywhere in the hot path.

None of these are exotic. They're the difference between "it works" and "it's safe to publish."

## What goes wrong

The failure mode is almost always the same: **untrusted input reaches a sink through a shell string or an interpolated identifier.** A command assembled with template interpolation and handed to a shell; a table or column name dropped straight into SQL; a file path from a tool argument used without a base-directory check.

Across 194 unique servers we read, we found **six High-severity issues**: three OS command injections, two HTTP transports bound to `0.0.0.0` with no authentication (exposing their tools — in one case arbitrary shell execution — to anyone on the same network, or to a web page the user visits via DNS rebinding), and one database server whose read-only guard could be bypassed. The command injections all share one shape: a tool argument reaching a shell through string interpolation on a code path that had no business running a shell (in one case the same server used the safe, argv-array pattern elsewhere and just regressed in a single spot). The read-only bypass is a different lesson in the same spirit: the server tried to allow only read queries, but checked only the *first keyword* at the application layer rather than wrapping the session in a database-enforced `BEGIN TRANSACTION READ ONLY` — allowing statement forms that pass the keyword check to still modify or delete rows. We're reporting each privately to its maintainer with a patch, and **we'll share details only after they're fixed.** *(Update: the first of the six fixes has already shipped and been published as [GHSA-w3gh-28jp-2hmv](https://github.com/IamNishant51/atlas-mcp-server/security/advisories/GHSA-w3gh-28jp-2hmv); we're adding each remediation to the [`mcp-ship-check` README](https://github.com/bot2botlabs/mcp-ship-check#verified-advisories--remediations) as maintainers release patches.)* Everything else our check flagged was either a server whose job *is* to run commands (an intentional shell, not a bug) or a false positive we tuned out.

The lesson for builders: the bug is rarely the whole server. It's one `exec` that should have been an `execFile`, one `${table}` that should have been an allowlist, one path that skipped a `realpath`. They're easy to miss and easy to catch.

## A free check, so yours ships clean

We turned what we learned into a pre-ship check. It's deterministic, offline, reads only your source, and never installs or runs your server:

```
npx github:bot2botlabs/mcp-ship-check sinks --strict
```
*(Runs straight from the public [`bot2botlabs/mcp-ship-check`](https://github.com/bot2botlabs/mcp-ship-check) repo — the prebuilt CLI is committed, so there's no build step and no dependencies to install.)*

It looks for four things: a command built for a shell instead of an argv array; a filesystem path from a tool argument with no base-directory guard; a SQL statement built by interpolation instead of placeholders; and an MCP HTTP transport exposed beyond loopback (bound to `0.0.0.0`, or missing DNS-rebinding protection). By default it only warns, so it won't break your CI; add `--strict` to make it fail the build.

It's a targeting aid, not a verdict — it points you at the lines worth a second look. Run it on your server before you publish. If it's wrong about yours, send us a PR; we'd rather fix the check than cry wolf.

*Shipping an MCP server and want a second set of eyes on its trust boundaries before launch? We do quick, hands-on reviews for small teams and solo builders — open an issue on [`bot2botlabs/mcp-ship-check`](https://github.com/bot2botlabs/mcp-ship-check) or reach out, and we'll take a look.*

---

*Bot2Bot Labs keeps a daily, public-data archive of the MCP shelf. This is the second in a series on what's actually out there.*
