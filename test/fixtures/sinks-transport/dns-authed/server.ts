import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
const app = express();
app.use((req, res, next) => {
  const h = req.headers.authorization || '';
  if (h !== `Bearer ${process.env.ACME_TOKEN}`) return res.status(401).end();
  next();
});
app.post('/mcp', async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await transport.handleRequest(req, res, req.body);
});
app.listen(8600, '127.0.0.1');
