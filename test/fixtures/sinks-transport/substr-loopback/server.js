const express = require('express');
const app = express();
function isLocal(req) {
  const ip = req.socket.remoteAddress || '';
  return ip.includes('127.0.0.1') || ip.includes('::1');
}
app.post('/mcp', (req, res) => (isLocal(req) ? res.json({ ok: true }) : res.status(401).end()));
app.listen(8787, '127.0.0.1');
