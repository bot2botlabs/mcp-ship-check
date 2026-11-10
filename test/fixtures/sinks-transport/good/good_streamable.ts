import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
const app = express();
const host = process.env.HOST || '127.0.0.1';
app.post('/mcp', async (req, res) => {
  const t = new StreamableHTTPServerTransport({
    enableJsonResponse: true,
    enableDnsRebindingProtection: true,
    allowedHosts: ['127.0.0.1:3000', 'localhost:3000'],
  });
  await server.connect(t);
});
app.listen(3000, host, () => { console.error('up'); });
