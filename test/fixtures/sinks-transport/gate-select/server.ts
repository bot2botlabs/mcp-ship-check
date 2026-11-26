import { createServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
const transport = new StreamableHTTPServerTransport();
const httpSrv = createServer(async (req, res) => {
  const host = req.headers.host || '';
  const isLocal = host.includes('localhost') || host.includes('127.0.0.1'); // only picks a URL
  const endpoint = isLocal ? `http://localhost:3000/mcp` : '/mcp';
  if (req.url === '/mcp') { await transport.handleRequest(req, res); return; }
  res.end(endpoint);
});
httpSrv.listen(3000, '0.0.0.0', () => {});
