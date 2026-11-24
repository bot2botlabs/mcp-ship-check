import { WebSocketServer } from 'ws';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
const wss = new WebSocketServer({ port: 8765 });
wss.on('connection', (socket) => { void new McpServer({ name: 'x', version: '1' }); });
