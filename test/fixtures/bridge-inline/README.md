# acme-inline

Stdio-only clients can bridge with `npx -y mcp-remote@0.14.3 https://mcp.example.com/mcp`.

With Bun: `bunx mcp-remote https://mcp.example.com/mcp --header x-api-key:$ACME_KEY`.

Claude Code: ``claude mcp add acme -- pnpm dlx mcp-remote@0.1.37 https://mcp.example.com/mcp``.

## Not install instructions

The bridge is `mcp-remote`; older guides used `mcp-remote@0.14.3`.
Our config uses `npx mcp-remote` under the hood, and `npx mcp-remote@0.1.10` was a typo.
See `npx my-mcp-remote-helper https://mcp.example.com/mcp` for a look-alike package.
{ this brace line mentions mcp-remote@0.1.10 but is not JSON }

## Sample config (unfenced)

{
  "mcpServers": {
    "acme-unfenced": {
      "command": "npx",
      "args": ["-y", "mcp-remote@latest", "http://localhost:3001/mcp", "--allow-http"]
    }
  }
}
