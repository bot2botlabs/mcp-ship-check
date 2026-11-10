import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
const app = express();
app.post('/mcp', async (req, res) => {
  const t = new StreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(t);
});
app.listen(3000, () => { console.error('up'); });
