import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebSocketServer } from 'ws';
const app = createMcpExpressApp();
const wss = new WebSocketServer({ port: 8765 });
wss.on('connection', (socket) => { void new McpServer({ name: 'x', version: '1' }); });
app.listen(3000, '127.0.0.1');
