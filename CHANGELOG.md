# Changelog

All notable changes to `mcp-ship-check` are recorded here. This project aims to
follow semantic versioning.

## [0.9.4] - 2026-11-25
### Added
- `authz` family (credential hygiene, low severity — review signals tied to the
  token-abuse threat): (1) a token minted with no expiry (`jwt.sign`/`SignJWT`/
  `jwt.encode` with no `expiresIn`/`exp`/`setExpirationTime` in the file),
  (2) a `redirect_uri` validated by prefix/substring (`startsWith`/`includes`)
  instead of an exact allowlist, (3) a wildcard (`'*'`) entry in an
  allowed-origins/redirects list literal. Suppressed when an expiry is set or the
  redirect is matched against an exact allowlist.

## [0.9.3] - 2026-11-25
### Fixed
- `sinks` transport: a Host/Origin check is now credited only when it actually
  **gates** the response — a strong guard token (`enableDnsRebindingProtection`,
  `validate/checkHost()`, `allowedHosts`/`allowedOrigins`) or a host/origin value
  within ~120 chars of a 401/403/forbidden denial. A bare `req.headers.host` read
  that only selects a value (e.g. `host.includes('localhost') ? urlA : urlB`) no
  longer downgrades a `0.0.0.0`-bind finding (false negative found on
  letoribo/mcp-graphql-enhanced; a 404 does not count as a gate).

## [0.9.2] - 2026-11-24
### Fixed
- `sinks` transport: credit auth middleware applied to a route
  (`app.post("/mcp", authenticateToken, …)`) and common auth libraries
  (`passport.authenticate`, `express-jwt`, `jwtVerify`, Clerk) in the
  `authenticates()` check. An authenticated MCP route now reports a
  DNS-rebinding exposure as an "ok, dead-ends at auth" note instead of a false
  warning. Kept narrow: a server with no such middleware still warns, and an
  all-interfaces (`0.0.0.0`) bind still warns even when auth is present, since
  authentication does not undo LAN exposure.

## [0.9.1] - 2026-11-24
### Fixed
- Reduced false positives in the `upload` (file-upload / web-shell) and
  WebSocket transport checks, with added scope fixtures.

## [0.9.0] - 2026-11-23
### Added
- `upload` family: unrestricted file upload / web shell (ATT&CK T1505.003) — a
  write sink whose name/extension comes from tool input with no allowlist.
- `transport` WebSocket check: a WebSocket MCP transport that accepts upgrades
  with no Host/Origin validation (cross-site WebSocket hijacking;
  cf. CVE-2026-59950).
### Included from 0.8.0 / 0.7.1
- `0.8.0`: the `upload` family groundwork.
- `0.7.1`: correct reading of object-form `listen({ host, port })` and Unix
  socket bind shapes.
