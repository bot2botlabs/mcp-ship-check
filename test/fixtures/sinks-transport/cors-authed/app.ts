import express from 'express';
import cors from 'cors';
import { handle } from './handler.js';
export const app = express();
app.use(cors({ origin: '*' }));
app.use((req, res, next) => {
  if (req.headers.authorization !== `Bearer ${process.env.ACME_TOKEN}`) return res.status(401).end();
  next();
});
app.post('/mcp', handle);
app.listen(8502, '127.0.0.1');
