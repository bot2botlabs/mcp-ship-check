import { createServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
const transport = new StreamableHTTPServerTransport();
const ALLOWED = ['localhost:3000', '127.0.0.1:3000'];
const httpSrv = createServer(async (req, res) => {
  if (!ALLOWED.includes(req.headers.host || '')) { res.writeHead(403); res.end('forbidden'); return; }
  await transport.handleRequest(req, res);
});
httpSrv.listen(3000, '0.0.0.0', () => {});
