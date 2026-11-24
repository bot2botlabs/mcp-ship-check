import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
const app = express();
const server = new McpServer({ name: 'x', version: '1' });
app.listen({ port: 3000, host: undefined });
app.listen({ port: 3001, host: HOST });
