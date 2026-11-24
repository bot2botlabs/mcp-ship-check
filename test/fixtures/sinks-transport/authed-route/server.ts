import express, { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { authenticateToken } from './auth.js';
const app = express();
app.use(express.json());
app.post('/mcp', authenticateToken, async (req: Request, res: Response) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => '1' });
  void new McpServer({ name: 'x', version: '1' });
  await transport.handleRequest(req, res, req.body);
});
app.listen(3000, () => console.log('up'));
