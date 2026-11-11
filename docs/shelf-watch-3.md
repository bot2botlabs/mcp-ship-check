# Shelf Watch #3: What good looks like on a hosted enterprise MCP server (and why the client bridge is still part of your attack surface)

In Shelf Watch #2 we read the code of 194 MCP servers and found the usual failure modes: a tool argument reaching a shell, a database "read-only" guard that only checked the first keyword, an HTTP transport listening on every network interface. That post was about what goes wrong.

This one is about the other end of the shelf: what a well-guarded hosted MCP server should look like, especially one that runs for many tenants at once, like the servers MSPs and security vendors are starting to ship. Below is our **Enterprise MCP Reference Blueprint**: four controls we'd want on any multi-tenant MCP server. None of them needs an enterprise budget. A two-person team can build every one.

The blueprint draws on what we've seen in production hosted MCP architectures and on the MCP specification's `2025-11-25` [Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) and [Elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation) sections. The specific limits and exclusions below are **our design targets**, not a description of any one product.

Then we'll look at the part of the connection a server can't protect on its own: the client-side bridge that many setups use to reach a remote MCP server.

## 1. Login scopes that mirror the roles you already have

**The blueprint.** Clients sign in with OAuth 2.1 and PKCE, as the [MCP authorization spec](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) describes, not with a static API key. The token's scopes map onto the product's existing role-based access, with separate read and write grants per area of the product. An agent gets exactly the access its operator's role already has, and reading never implies writing.

**Why it matters.** The MCP layer inherits the permission model your product has already battle-tested, instead of inventing a second, weaker one beside it. A leaked or over-shared token can only do what that user could already do.

**How a small team can copy it:**
- Put your MCP server behind the identity provider you already use, with OAuth 2.1 + PKCE, rather than issuing long-lived API keys.
- Define read and write scopes per area of your product (`yourapp:invoices:read`, `yourapp:invoices:write`), and grant them from the roles you already have.
- Check the required scope inside every tool handler, and deny by default. A tool that forgets its check should fail, not run.

## 2. Small blast radius by default

**The blueprint.** Cap requests per token. We use 100 per minute as a starting point for an interactive agent. Let each call touch one resource, and scope every write tool to a single subject: one device, process, file, user or incident. There's no "apply to all" write path.

**Why it matters.** Even with valid credentials, a confused or prompt-injected agent can't turn one bad call into a fleet-wide action. The worst case is bounded by design rather than by hoping the model behaves.

**How a small team can copy it:**
- Rate-limit per token, not just per IP.
- Make write tools take a single ID. No arrays, no wildcards, no `all: true` flag.
- Cap list sizes in your input schemas (`maxItems`), and paginate reads.
- If you genuinely need bulk operations, keep them in your admin UI or API, outside the MCP surface.

## 3. Human approval on every write, and refusal when approval isn't possible

**The blueprint.** Every write tool waits for synchronous, in-chat human approval before it runs. If the connecting client can't show that approval step, the call **fails closed** instead of running unapproved.

**Why it matters.** This is the property the vulnerable servers in Shelf Watch #2 lacked. They ran dangerous operations with no human in the loop at all. "Refuse when we can't ask" is the safe default; "run anyway" is how a missing UI feature becomes an incident.

**How a small team can copy it:**
- Mark every tool honestly with MCP's annotations: `readOnlyHint` for reads, `destructiveHint` for anything that changes or deletes. In Shelf Watch #2, a third of the tools we could inspect declared neither.
- For writes, ask the user to confirm through the client before acting. MCP's [elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation) feature exists for this: clients that support it declare an `elicitation` capability when they connect, so your server knows up front whether it can ask.
- If the client can't confirm (no `elicitation` capability, or the user declines), return an error that says why. Don't fall back to running the action.

## 4. Sensitive tools stay off the external surface

**The blueprint.** Tools that move money or entitlements (license allocation, trial changes, billing) aren't exposed to external MCP clients at all. If a vendor's own first-party assistant needs them, it gets them on a separate internal surface. The external surface is deliberately a subset of the internal one.

**Why it matters.** Not every tool belongs on a connector that any compatible client can reach. Anything that moves money, entitlements or billing state is a much bigger prize than a read-only query.

**How a small team can copy it:**
- Keep a separate tool list for the MCP server you expose externally. Don't expose "everything the backend can do" by default.
- Leave billing, license, plan and payment actions out entirely. Send users to your own UI for those.
- Review the external tool list like a public API surface, because that's what it is.
- When you do need license and billing numbers, compute them outside the model. Our [`msp-seat-reconcile`](../examples/msp-seat-reconcile/) example reconciles seat inventory against PSA billing in plain, deterministic code.

## 5. The bridge is part of your attack surface too

All four controls above live on the server. But many clients reach a remote MCP server through a local bridge: most often the open-source [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) package, launched from the client's config with something like `npx -y mcp-remote@<version> https://…`. That bridge runs on the user's own machine, handles their login, and stores their tokens. A well-guarded server can't protect a user whose bridge is out of date.

Two public advisories show why this matters:

- **CVE-2025-6514** affected `mcp-remote` before `0.1.16`. A malicious server could put a crafted URL in its OAuth metadata and get it run as a command on the user's machine [JFrog write-up](https://jfrog.com/blog/2025-6514-critical-mcp-remote-rce-vulnerability/).
- **CVE-2026-108716** is listed as affecting `0.8.0` through `0.14.3`. In the device-code login flow, the client secret and the issued tokens can be sent over plain HTTP if the authorization server's endpoints aren't HTTPS. The advisory names no fixed version [VulnCheck advisory](https://www.vulncheck.com/advisories/mcp-remote-0.8.0-through-0.14.3-cleartext-credential-transmission-via-device-code-oauth-grant). It only applies when the bridge is started with `--device-code`, so a normal browser login doesn't hit it.

Pinning a version is a tradeoff. An exact pin is reproducible and immune to a bad new release, but it stays frozen as advisories are published against it. An unpinned `npx mcp-remote` picks up fixes, but it also picks up whatever ships next. Our suggestion: **pin an exact version, then actually re-check it on a schedule.** That goes double if your product's docs tell customers which bridge to run: your setup snippet is part of your security surface.

To make the re-check cheap, we added a `bridge` check to our free, offline [`mcp-ship-check`](https://github.com/bot2botlabs/mcp-ship-check). It reads MCP client configs (`claude_desktop_config.json`, `.mcp.json`, `mcp.json`, including `.cursor/` and `.vscode/`) and the code blocks in your docs, and checks every `mcp-remote` invocation against known advisories:

```
npx github:bot2botlabs/mcp-ship-check bridge --strict
```

Here's what it reports on a sample config with three servers:

```text
✖ bridge: 1 config/Markdown file(s) scanned; 3 mcp-remote invocation(s); 3 error(s), 0 warning(s) — --strict: warnings are errors
✖ bridge-cve-2025-6514: claude_desktop_config.json:3 (acme-legacy): mcp-remote@0.1.15 is in CVE-2025-6514's affected range (< 0.1.16): OS command injection via a malicious server's OAuth authorization_endpoint — upgrade to 0.1.16 or later
✖ bridge-cve-2026-108716: claude_desktop_config.json:4 (acme): mcp-remote@0.12.0 is in CVE-2026-108716's affected range (0.8.0–0.14.3): client secret and tokens can be sent over cleartext HTTP in the device-code grant; this invocation doesn't pass --device-code, so the vulnerable path isn't used as written — move to a version outside the advisory's listed range (unconfirmed upstream fix)
✖ bridge-device-code: claude_desktop_config.json:5 (acme-ci): passes --device-code; CVE-2026-108716 (client secret and tokens can be sent over cleartext HTTP in the device-code grant) has no confirmed upstream fix — mcp-remote@0.16.5 is outside the advisory's listed range (unconfirmed upstream fix); make sure the auth server's device-authorization and token endpoints are HTTPS
FAIL (4 checks)
```

Two details matter here. First, the check never calls a version "patched" just because it sits above an advisory's listed range: when no fixed release is named, it says the fix is unconfirmed. Second, it flags `--device-code` on *any* version until an upstream fix is confirmed. It also flags `--allow-http` pointed at a non-loopback `http://` URL, and an unpinned `mcp-remote` as information (since it can't be checked offline). Without `--strict` it only warns, so you can add it to CI without breaking anything on day one.

## A checklist for your MCP server

Server side:
- [ ] OAuth 2.1 + PKCE, with scopes that map onto roles you already have; scope checked in every tool, deny by default.
- [ ] Rate limits per token; one subject per write call; list sizes capped.
- [ ] Every tool honestly annotated as read-only or destructive; writes confirmed by the user; refused when the client can't confirm.
- [ ] Billing, license and payment actions kept off the external MCP surface.
- [ ] `npx github:bot2botlabs/mcp-ship-check sinks --strict` on your source: no shell strings, unguarded paths, interpolated SQL or exposed HTTP transport.

Client side:
- [ ] Your setup docs pin an exact bridge version, and someone re-checks it on a schedule.
- [ ] `npx github:bot2botlabs/mcp-ship-check bridge --strict` in CI, over your configs and docs.
- [ ] No `--allow-http` to a non-loopback host; `--device-code` only against HTTPS endpoints you control.

*Shipping an MCP server and want a second set of eyes on its trust boundaries before launch? We do quick, hands-on reviews for small teams and solo builders — open an issue on [`bot2botlabs/mcp-ship-check`](https://github.com/bot2botlabs/mcp-ship-check) or reach out, and we'll take a look.*

---

**Sources**
- MCP specification (2025-11-25): [Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) · [Elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)
- CVE-2025-6514: [JFrog write-up](https://jfrog.com/blog/2025-6514-critical-mcp-remote-rce-vulnerability/)
- CVE-2026-108716: [VulnCheck advisory](https://www.vulncheck.com/advisories/mcp-remote-0.8.0-through-0.14.3-cleartext-credential-transmission-via-device-code-oauth-grant)
- Shelf Watch #2: [What we found auditing 194 MCP servers for code-level sinks](https://github.com/bot2botlabs/mcp-ship-check/blob/main/docs/shelf-watch-2.md)

*Bot2Bot Labs keeps a daily, public-data archive of the MCP shelf. This is the third in a series on what's actually out there.*
