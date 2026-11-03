# mcp-ship-check

`mcp-ship-check` performs pre-publish consistency checks for Model Context Protocol (MCP) servers. It catches drift between `package.json`, MCPB `manifest.json`, registry `server.json`, the server's live `tools/list`, and what is actually published on npm and the official MCP registry.

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
mcp-ship-check <files|tools|published> [dir] [options]
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

Queries public package registries to check published state against the local package.

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

## Exit Codes

| Exit Code | Meaning | Description |
|:---:|:---|:---|
| `0` | OK | All executed checks passed (or emitted only warnings / skips). |
| `1` | Check failed | One or more checks failed (`error` level), such as version mismatch, tool parity failure, or published npm version newer than local. |
| `2` | Couldn't run | Execution could not proceed due to invalid CLI arguments, missing `package.json`, server crash / timeout, or network failure when reaching registries. |

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
