import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import cors from 'cors';
import { timingSafeEqual } from 'node:crypto';
const app = express();
app.use(cors());
// Calls the upstream API with the operator's key. Nothing here checks who is calling us.
const upstream = (path: string) => fetch('https://api.acme.test' + path, { headers: { Authorization: `Bearer ${process.env.ACME_API_KEY}` } });
export const sameSig = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);
app.post('/mcp', async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await transport.handleRequest(req, res, req.body);
});
app.listen(8601, '127.0.0.1');
