const express = require('express');
const app = express();
const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const isLocal = (req) => LOCAL.has(req.socket.remoteAddress);
const docs = (text) => text.includes('::1'); // not an address check
app.post('/mcp', (req, res) => (isLocal(req) ? res.json({ ok: docs('') }) : res.status(401).end()));
app.listen(8787, '127.0.0.1');
