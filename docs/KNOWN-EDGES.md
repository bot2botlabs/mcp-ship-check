## Found by Codex (core)

- Version precedence assumes valid semver strings; malformed package versions are not validated.
- MCPB URL version detection recognizes standalone version path segments, not versions embedded in filenames.
- Windows shell quoting and descendant process cleanup are best effort; CI exercises Linux.
- Glama checks listing availability only because listing metadata does not provide a uniform package version field.
- Stdio transport expects newline-delimited JSON and does not support Content-Length framing.

## Found by Gemini (docs/action)

- Monorepos: The CLI targets a single directory with a root `package.json`; monorepos with multiple MCP packages require running `mcp-ship-check` separately against each package directory.
- Python and non-Node.js servers: Python MCP servers using `pyproject.toml` or `setup.py` (and servers written in Go, Rust, etc.) are unsupported without a `package.json`; missing `package.json` results in an immediate exit code 2.
- HTTP and alternative transports: The `tools` command only supports stdio JSON-RPC servers; Server-Sent Events (SSE), HTTP POST, and WebSocket MCP server endpoints cannot be inspected.
- Servers requiring startup environment variables: Servers that fail or exit if certain environment variables or credentials are absent will fail the `tools` check unless those variables are explicitly passed via `--env KEY=VAL`.
- npm git dependency build latency: Running via `npx github:bot2botlabs/mcp-ship-check` requires npm to clone the repository and run its `prepare` build step (`tsc`), adding invocation delay compared to an installed npm package.
- Windows process tree cleanup: On Windows, terminating the child MCP server process does not kill spawned subprocess trees because detached process groups are not supported the same way as on POSIX systems.
