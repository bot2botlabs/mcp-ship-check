import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebSocketServer } from 'ws';
const ok = (o) => o === 'http://localhost:3000';
const wss = new WebSocketServer({ port: 8766, verifyClient: (info) => ok(info.origin) });
wss.on('connection', (socket) => { void new McpServer({ name: 'x', version: '1' }); });
