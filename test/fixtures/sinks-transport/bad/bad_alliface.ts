import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';
const app = express();
const transport = new SSEServerTransport('/messages', res);
app.listen(3000, '0.0.0.0');
