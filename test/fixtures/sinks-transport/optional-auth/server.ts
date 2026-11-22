import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import cors from 'cors';
const app = express();
app.use(cors());
const TOKEN = process.env.ACME_TOKEN ?? '';
app.use((req, res, next) => {
  if (!TOKEN) return next();
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return res.status(401).end();
  next();
});
app.post('/mcp', async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await transport.handleRequest(req, res, req.body);
});
app.listen(8602, '127.0.0.1');
