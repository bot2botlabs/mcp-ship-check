import express from 'express';
import cors from 'cors';
import { handle } from './handler.js';
export const app = express();
app.use(cors({ origin: '*', exposedHeaders: ['Mcp-Session-Id'] }));
// app.use(requireBearerAuth());
app.post('/mcp', handle);
app.listen(8502, '127.0.0.1');
