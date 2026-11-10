import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'node:http';
const transport = new StreamableHTTPServerTransport();
const httpHost = process.env.HOST || '127.0.0.1';
const allowedHosts = ['127.0.0.1:3000', 'localhost:3000'];
const httpServer = createServer((req, res) => {
  if (!validateHostHeader(req, res, httpHost, allowedHosts)) return;
  void transport.handleRequest(req, res);
});
httpServer.listen(3000, httpHost, () => {});
