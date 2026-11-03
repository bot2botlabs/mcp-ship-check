# mcp-ship-check

Pre-publish consistency checks for MCP servers (package.json ↔ MCPB manifest.json ↔ server.json ↔ live tools/list ↔ published npm/registry). Work in progress.

## Usage

```sh
mcp-ship-check files . --json
mcp-ship-check tools . --cmd "node dist/index.js"
mcp-ship-check published . --no-glama
```
