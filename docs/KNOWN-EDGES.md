## Found by Codex (core)

- Version precedence assumes valid semver strings; malformed package versions are not validated.
- MCPB URL version detection recognizes standalone version path segments, not versions embedded in filenames.
- Windows shell quoting and descendant process cleanup are best effort; CI exercises Linux.
- Glama checks listing availability only because listing metadata does not provide a uniform package version field.
- Stdio transport expects newline-delimited JSON and does not support Content-Length framing.

## Found by Gemini (docs/action)

- Monorepos: The CLI targets a single directory with a root package or plugin configuration; monorepos with multiple MCP packages require running `mcp-ship-check` separately against each package directory.
- Python and non-Node.js servers: Python MCP servers using `pyproject.toml` or `setup.py` (and servers written in Go, Rust, etc.) need a `package.json` or recognized plugin/MCP JSON configuration for `files` and `published`; language-specific metadata is not read.
- HTTP and alternative transports: The `tools` command only supports stdio JSON-RPC servers; Server-Sent Events (SSE), HTTP POST, and WebSocket MCP server endpoints cannot be inspected.
- Servers requiring startup environment variables: Servers that fail or exit if certain environment variables or credentials are absent will fail the `tools` check unless those variables are explicitly passed via `--env KEY=VAL`.
- npm git dependency build latency: Running via `npx github:bot2botlabs/mcp-ship-check` requires npm to clone the repository and run its `prepare` build step (`tsc`), adding invocation delay compared to an installed npm package.
- Windows process tree cleanup: On Windows, terminating the child MCP server process does not kill spawned subprocess trees because detached process groups are not supported the same way as on POSIX systems.

## Found while dogfooding

- `files` reports `PASS` (exit 0) when manifest.json and server.json are both absent and every result is `skip`, so "nothing compared" looks the same as "consistent".
- `tools` warns `manifest declares no tools` even when there is no manifest.json at all; this should be a skip.
- The README tool-name check only looks for manifest-declared names in the README. It never flags README-documented tool names that don't exist live (e.g. `create_bill` vs live `create-bill`), and it is skipped entirely when there is no manifest.
- The README count regex `(\d+)\s+tools` misses common phrasings such as "145 Total Tools" and `Tools-145` shields badges, so stale counts go unflagged.
- The README tool-name check is noisy for READMEs that cover tools through summary tables (entity × CRUD ✅ grids) rather than listing each name.
- The Glama API endpoint `https://glama.ai/api/mcp/v1/servers/<owner>/<repo>` now returns HTTP 401 without auth, so the Glama check always ends in `skip: could not check: HTTP 401`.
- Server stderr is kept as the last 2048 characters and can start mid-word, which drops the first (usually most useful) error line from long stack traces.

- Hosted-MCP Agent Plugins: `files` and `published` support root/Cursor plugin manifests and MCP JSON configs without npm metadata. Skills are not parsed for versions or URLs. README prose, homepage links, and arbitrary config discovery are outside these checks.
- Plugin URL agreement uses exact strings; trailing slashes and different endpoint paths count as drift. Multiple named MCP servers may use different URLs; unnamed `server.json` remotes are compared with all configured endpoints, so complex multi-server registry layouts may need separate target directories.
- Plugin registry checks require `server.json` name and an available version; plugin manifest names are not assumed to be registry identifiers. `tools` still requires a stdio command and does not connect to hosted URLs.
