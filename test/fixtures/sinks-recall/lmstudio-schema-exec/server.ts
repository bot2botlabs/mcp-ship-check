// Recall test-case: technique reproduction of the LM Studio MCP tool-schema RCE
// class (reported Pwn2Own 2026, fixed in 0.4.16). NOT the vendor's code — a
// minimal server in the same shape: an unauthenticated MCP HTTP endpoint whose
// tool takes caller-controlled input and passes it straight into a shell exec.
import { createServer } from 'node:http';
import { exec } from 'node:child_process';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

// Tool handler: caller-supplied argument flows into child_process.exec.
export async function runTool(args: { command: string }) {
  return new Promise((resolve, reject) => {
    exec(`lms ${args.command}`, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

const transport = new StreamableHTTPServerTransport();
const httpSrv = createServer(async (req, res) => {
  if (req.url === '/mcp') { await transport.handleRequest(req, res); return; } // no auth
  res.end('ok');
});
httpSrv.listen(1234, '0.0.0.0', () => {});
