# mcp-ship-check

`mcp-ship-check` performs pre-publish consistency checks for Model Context Protocol (MCP) servers. It catches drift between `package.json`, MCPB `manifest.json`, registry `server.json`, the server's live `tools/list`, and what is actually published on npm and the official MCP registry. Hosted-MCP Agent Plugins without `package.json` are also supported by `files` and `published`.

## Install and Run

`mcp-ship-check` is not published to npm yet. You can run it directly using `npx` via GitHub:

```bash
npx github:bot2botlabs/mcp-ship-check files .
```

You can also install it as a development dependency:

```bash
npm install -D github:bot2botlabs/mcp-ship-check
```

General CLI usage:

```bash
mcp-ship-check <files|tools|published|sinks> [dir] [options]
```

Global flags:
- `--json`: Output report as JSON.
- `--help`, `-h`: Show usage help.
- `--version`: Show CLI version.

## Commands

### `files`

Checks static consistency across configuration files in the specified directory (defaults to `.`).

```bash
mcp-ship-check files [dir] [--json]
```

#### What it checks
- **`version`**: Compares `version` across `package.json`, `manifest.json`, and `server.json`. Emits an error if any existing documents have mismatched versions.
- **`name`**: Compares `package.json` `name` (with `@scope/` stripped) against `manifest.json` `name`. Emits a warning if they differ.
- **`mcpName`**: If `server.json` is present, verifies that `package.json` defines `mcpName` matching `server.json` `name` (required for registry publishing). Emits an error if missing or mismatched.
- **`$schema`**: If `server.json` is present, verifies that `$schema` is set. Emits an error if missing.
- **`registryType`**: Verifies that package entries in `server.json` use camelCase `registryType` rather than `registry_type`. Emits an error if snake_case is used.
- **`npm identifier`**: For npm packages in `server.json`, checks that `identifier` matches `package.json` `name`. Emits an error if mismatched.
- **`npm version`**: For npm packages in `server.json` that specify a version, checks that it matches `package.json` `version`. Emits an error if mismatched.
- **`mcpb version`**: For MCPB bundle URLs in `server.json`, extracts any version segment from the path and warns if it differs from `package.json` `version`.
- **`mcpb sha256`**: For MCPB packages in `server.json` declaring `fileSha256`, searches for a local bundle (`<name>`, `dist/<name>`, or a single `.mcpb` file in the directory), computes its SHA-256 hash, and compares it to `fileSha256`. Emits an error on mismatch, or skips if no local file exists.
- **Optional files**: If `manifest.json` or `server.json` are absent, skips them without error.

#### Agent Plugins (no `package.json`)

Recognizes `plugin.json`, `.cursor-plugin/plugin.json`, `mcp.json`, or `.mcp.json`. Reads inline manifest `mcpServers` or a project-relative MCP config path, plus optional `manifest.json` and `server.json`. A `skills/` directory may accompany the plugin; skills alone do not identify an MCP project.

Compares versions and names wherever declared (registry-qualified names use their final path component). For a single hosted server, also compares the MCP config server key with the plugin name. Checks that declared MCP URLs use HTTPS and that repeated declarations agree exactly. Distinct named servers may use distinct URLs. Missing optional metadata produces skips; npm-only metadata checks emit a clear skip instead of failing.

```bash
mcp-ship-check files ~/Projects/deadline-desk-plugin
mcp-ship-check published ~/Projects/deadline-desk-plugin --no-glama
```

#### Example human output
```
✔ version: package.json 1.2.0 = manifest.json 1.2.0
✔ version: package.json 1.2.0 = server.json 1.2.0
✔ version: manifest.json 1.2.0 = server.json 1.2.0
✔ name: package.json @demo/example, manifest.json example
✔ mcpName: package.json mcpName io.demo/example; server.json name io.demo/example (mcpName required for registry publishing)
✔ $schema: server.json revision 2025-12-11
✔ npm identifier: server.json identifier @demo/example; package.json name @demo/example
✔ npm version: server.json package version 1.2.0; package.json version 1.2.0
✔ mcpb sha256: local example.mcpb sha256 6800e9d30bcbb0f6b09e02fdd24bcc053505045a2117b2e201ee472b7e86e652; server.json fileSha256 6800e9d30bcbb0f6b09e02fdd24bcc053505045a2117b2e201ee472b7e86e652
PASS (9 checks)
```

#### Example `--json` output
```json
{"command":"files","ok":true,"results":[{"id":"version","level":"ok","message":"package.json 1.2.0 = manifest.json 1.2.0"},{"id":"version","level":"ok","message":"package.json 1.2.0 = server.json 1.2.0"},{"id":"version","level":"ok","message":"manifest.json 1.2.0 = server.json 1.2.0"},{"id":"name","level":"ok","message":"package.json @demo/example, manifest.json example"},{"id":"mcpName","level":"ok","message":"package.json mcpName io.demo/example; server.json name io.demo/example (mcpName required for registry publishing)"},{"id":"$schema","level":"ok","message":"server.json revision 2025-12-11"},{"id":"npm identifier","level":"ok","message":"server.json identifier @demo/example; package.json name @demo/example"},{"id":"npm version","level":"ok","message":"server.json package version 1.2.0; package.json version 1.2.0"},{"id":"mcpb sha256","level":"ok","message":"local example.mcpb sha256 6800e9d30bcbb0f6b09e02fdd24bcc053505045a2117b2e201ee472b7e86e652; server.json fileSha256 6800e9d30bcbb0f6b09e02fdd24bcc053505045a2117b2e201ee472b7e86e652"}]}
```

---

### `tools`

Starts the MCP server over stdio, performs the `initialize` handshake, calls `tools/list` (with pagination), and checks live tools against `manifest.json` and `README.md`.

```bash
mcp-ship-check tools [dir] [--cmd "node dist/index.js"] [--timeout 15000] [--env KEY=VAL ...] [--json]
```

Options:
- `--cmd <command>`: Command string used to spawn the server over stdio. If omitted, uses `manifest.json` `server.mcp_config` (`command` and `args`, with `${__dirname}` replaced by the target directory).
- `--timeout <ms>`: Server startup and response timeout in milliseconds (default: `15000`).
- `--env <KEY=VAL>`: Pass environment variables to the server process (can be specified multiple times).

#### What it checks
- **`live tools`**: Discovers live tools from the server over stdio.
- **`manifest tools`**: Warns if `manifest.json` declares no tools or lacks a `tools` array.
- **Manifest vs. live tool parity**:
  - Emits an error for each live tool missing from `manifest.json`.
  - Emits an error for each tool in `manifest.json` missing from live tools.
  - Emits a warning if a tool description in `manifest.json` differs from the live description (ignoring collapsed whitespace).
- **README consistency** (if `README.md` exists in directory):
  - Emits a warning if a tool count pattern (`(\d+) tools`) in `README.md` does not match the live count.
  - Emits a warning if any tool declared in `manifest.json` is missing from the text of `README.md`.

#### Example human output
```
✔ live tools: 3 tools: alpha, beta, gamma
PASS (1 checks)
```

#### Example `--json` output
```json
{"command":"tools","ok":true,"results":[{"id":"live tools","level":"ok","message":"3 tools: alpha, beta, gamma"}]}
```

---

### `published`

Queries public package registries to check published state against the local package. For Agent Plugins, runs the local metadata/URL checks, skips npm, and queries the MCP registry only when a registry name and local version exist in `server.json`. Glama repository inference also accepts plugin manifest repository metadata. A plugin slug alone is not treated as an MCP registry name.

```bash
mcp-ship-check published [dir] [--no-glama] [--glama-url URL] [--timeout 15000] [--json]
```

Options:
- `--no-glama`: Skip querying Glama.
- `--glama-url <url>`: Override the default Glama server endpoint (default: inferred from `package.json` repository URL).
- `--timeout <ms>`: Network request timeout in milliseconds (default: `15000`).

#### What it checks
- **`npm`**: Queries `https://registry.npmjs.org/<package>` for the latest published version:
  - If published matches local: reports `ok`.
  - If published is newer than local: reports `error`.
  - If local is newer than published: reports `warn` (`unpublished local version`).
  - If package is not yet on npm (HTTP 404): reports `warn` (`not on npm`).
  - If network or other non-404 error occurs: reports `skip`.
- **`npm mcpName`**: If `package.json` defines `mcpName`, checks whether the latest version on npm has matching `mcpName` metadata. Emits an error if missing or mismatched.
- **`registry`**: Queries `https://registry.modelcontextprotocol.io/v0/servers/<name>/versions/latest` (using `mcpName` or `server.json` `name`). Compares latest published version to local version.
  - If not yet in registry (HTTP 404): reports `warn` (`not in registry`).
  - If neither `server.json` nor `package.json` `mcpName` is present: reports `skip`.
- **`glama`**: Checks whether the Glama listing endpoint is reachable. Failures are treated as best-effort (`skip`). Can be disabled with `--no-glama`.

#### Example human output
```
⚠ npm: not on npm
⚠ registry: not in registry
– glama: Disabled by --no-glama
PASS (3 checks)
```

#### Example `--json` output
```json
{"command":"published","ok":true,"results":[{"id":"npm","level":"warn","message":"not on npm"},{"id":"registry","level":"warn","message":"not in registry"},{"id":"glama","level":"skip","message":"Disabled by --no-glama"}]}
```

---

### `sinks`

Static **Safe Sinks** scan of the server's own source. It reads the JavaScript/TypeScript and Python files under the directory (skipping `node_modules/`, `dist/`, dotfiles, test files, and non-runtime trees like `scripts/`, `docs/`, `examples/` and browser `extension/`) and flags the *shape* of a risky sink: an argument that reaches process execution, the filesystem, a SQL string in an unsafe form, or an HTTP transport exposed beyond loopback. It is deterministic and offline — it never installs, runs, or calls the server, and it reads only source text.

```bash
mcp-ship-check sinks [dir] [--strict] [--json]
```

A flagged shape is a **review target, not a vulnerability finding** (facts, not verdicts). By default risky shapes are `warn` and the command still exits `0`, so adding it to CI can't break a pipeline; `--strict` promotes risky shapes to `error` (exit `1`) for teams that want to gate on it.

Options:
- `--strict`: Promote risky sink shapes from `warn` to `error`.

#### What it checks
- **Process execution** (`exec`): flags `exec`/`execSync` with a variable/interpolated command and `spawn`/`spawnSync`/`fork` with `shell: true`, **but only for functions actually bound to `child_process`** (imported or `cp.exec`) — a RegExp `.exec()` or any other `.exec` is not flagged. Python: `subprocess(..., shell=True)`, `os.system`, `os.popen`, `commands.getoutput`. Reports `ok` for `execFile`/argument-array forms and `subprocess` without `shell=True`.
- **Filesystem bounds** (`fs`): flags an `fs`/`open`/`pathlib`/`shutil` call whose path is **derived from a tool/request argument** (`req`, `params`, `body`, `upload`, `user…`, `filename`, …) when no `path.resolve`/`realpath` **and** base-directory containment check is present in the same file. Reports `ok` for literal paths, system/config roots (`homedir`/`env`/`__dirname`/`tmp`/`cwd`), guarded paths, and internal (non-tool-derived) variable paths. (File-scoped: a guard in another file is not seen.)
- **SQL / data queries** (`sql`): flags a string that matches a **SQL statement shape** (`SELECT … FROM`, `INSERT INTO`, `UPDATE … SET`, `DELETE FROM`, `CREATE/DROP/ALTER TABLE`, …) built by template-literal/f-string interpolation or `+`/`%`/`.format` concatenation — a lone keyword, `.join(`, or prose that merely mentions SQL is not flagged. Reports `ok` when SQL appears only as a parameterized/literal query (placeholders `?`, `$1`, `:name`).
- **Transport exposure** (`transport`, v2.6): in files that actually stand up an MCP HTTP transport, flags a `StreamableHTTPServerTransport` constructed **without** `enableDnsRebindingProtection: true`, an HTTP listener with **no bind host** (a callback as the 2nd arg, or omitted → Node defaults to `0.0.0.0`) or an explicit `'0.0.0.0'`/`'::'` bind, and Python `uvicorn.run`/`mcp.run` with `host="0.0.0.0"`. The MCP Streamable-HTTP spec (`2025-11-25`/`2026-07-28`) requires local servers to bind loopback and validate `Origin`/`Host` (cf. CVE-2026-57123, CVE-2026-59971). Reports `ok` for loopback binds, the SDK flag, **or a manual `Host`/`Origin` allowlist check** in the same file; gated to MCP-HTTP files so a plain Flask/Dash dashboard or non-MCP Express app is never flagged.

Comments and Python statement-position docstrings are stripped before matching (string literals are kept, so real SQL is still seen); string spans are collected in a single linear pass (no catastrophic backtracking on large files). Known limitations: no cross-file dataflow or reachability proof; a template that interpolates an internal **constant** fragment into a SQL statement (e.g. `` `SELECT ${COLS} FROM t` ``) still warns; `fs` flags only tool-derived paths and will miss a path laundered through an internal variable. Use it to *target* code review, not to certify a server.

#### Example human output
```
⚠ sinks: 3 source file(s); 2 risky sink shape(s), 5 safe sink(s) — review; a shape is not a vulnerability finding
⚠ exec: src/run.js:12 — child_process.exec (imported) runs a shell with a variable/interpolated command — use execFile([...]) with an argument array
⚠ sql: src/db.py:8 — SQL statement built by an f-string interpolation — use placeholders (?, $1, :name) with a separate params argument, or an AST/allowlist guard
✔ exec: src/git.js:4 — execFile uses an argument array (no shell)
PASS (4 checks)
```

#### Example `--json` output
```json
{"command":"sinks","ok":true,"results":[{"id":"sinks","level":"warn","message":"3 source file(s); 2 risky sink shape(s), 5 safe sink(s) — review; a shape is not a vulnerability finding"},{"id":"exec","level":"warn","message":"src/run.js:12 — child_process.exec runs a shell with a variable/interpolated command — use execFile([...]) with an argument array"}]}
```

---

## Exit Codes

| Exit Code | Meaning | Description |
|:---:|:---|:---|
| `0` | OK | All executed checks passed (or emitted only warnings / skips). |
| `1` | Check failed | One or more checks failed (`error` level), such as version mismatch, tool parity failure, or published npm version newer than local. |
| `2` | Couldn't run | Execution could not proceed due to invalid CLI arguments, missing both `package.json` and plugin/MCP configuration, server crash / timeout, or network failure when reaching registries. |

---

## GitHub Action Usage

You can run `mcp-ship-check` directly in GitHub Actions using the composite action at `bot2botlabs/mcp-ship-check@main`.

> [!NOTE]
> The composite action expects Node.js 20+ to be available on the runner (standard on `ubuntu-latest`). You should add `actions/setup-node@v4` in your workflow prior to invoking the action.

### Action Inputs

| Input | Description | Required | Default |
|---|---|:---:|:---:|
| `command` | Command to run (`files`, `tools`, `published`) | No | `files` |
| `directory` | Target MCP server directory | No | `.` |
| `server-command` | Command to run the MCP server (for `tools`) | No | `""` |
| `args` | Extra CLI arguments to pass (e.g. `--no-glama`, `--timeout 20000`) | No | `""` |
| `json` | Output report in JSON format (`true` or `false`) | No | `false` |

### Workflow Example

See [examples/workflows/ship-check.yml](examples/workflows/ship-check.yml) for a full example:

```yaml
name: MCP Ship Check

on:
  pull_request:
  push:
    tags:
      - 'v*'

jobs:
  ship-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci
      - run: npm run build

      - name: Check files
        uses: bot2botlabs/mcp-ship-check@main
        with:
          command: files

      - name: Check tools
        uses: bot2botlabs/mcp-ship-check@main
        with:
          command: tools
          server-command: node dist/index.js

      - name: Check published registry status
        if: startsWith(github.ref, 'refs/tags/')
        continue-on-error: true # Exit code 2 indicates network/registry outage
        uses: bot2botlabs/mcp-ship-check@main
        with:
          command: published
```

---

## What It Deliberately Leaves to Other Tools

`mcp-ship-check` strictly verifies consistency and drift. Complementary checks are handled by dedicated tools in the ecosystem:

- **`server.json` schema validation**: [`mcp-publisher validate`](https://github.com/modelcontextprotocol/registry)
- **Manifest schema validation**: [`mcpb validate`](https://github.com/modelcontextprotocol/mcpb)
- **Tool annotation and schema linting**: [`mcp-conform`](https://github.com/fernforge/mcp-conform)
- **`server.json` deep linting and SARIF generation**: [`mcp-passport`](https://github.com/studiomeyer-io/mcp-passport)
- **Breaking-change detection and lockfiles**: [`mcp-covenant`](https://github.com/studiomeyer-io/mcp-covenant)

---

## Credits / Related Work

- [modelcontextprotocol/registry](https://github.com/modelcontextprotocol/registry) – Official Model Context Protocol registry.
- [modelcontextprotocol/mcpb](https://github.com/modelcontextprotocol/mcpb) – MCP Bundles specification and tooling.
- [studiomeyer-io/mcp-passport](https://github.com/studiomeyer-io/mcp-passport) – Deep linting and SARIF exporter for `server.json`.
- [fernforge/mcp-conform](https://github.com/fernforge/mcp-conform) – MCP schema and annotation conformance testing.
- [asklar/mcpb](https://github.com/asklar/mcpb) – .NET CLI implementing `validate --discover`, which pioneered manifest↔live tool inspection.
- [studiomeyer-io/mcp-covenant](https://github.com/studiomeyer-io/mcp-covenant) – Contract testing and breaking-change detection for MCP tools.
- [fykong/agent-tool-drift](https://github.com/fykong/agent-tool-drift) – Tool drift detection across agent configurations.
- Hand-rolled precedents:
  - An Airtable MCP server pull request that added manifest/tool parity checks
  - [che-ical-mcp ManifestParityTests.swift](https://github.com/PsychQuant/che-ical-mcp/blob/main/Tests/CheICalMCPTests/ManifestParityTests.swift)

## License

[MIT](LICENSE)
