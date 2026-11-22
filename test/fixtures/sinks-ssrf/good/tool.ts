import { z } from 'zod';
const API_BASE = 'https://api.acme.test';
server.registerTool('get_item', { inputSchema: { id: z.string(), url: z.string() } }, async ({ id }) => {
  const a = await fetch(`https://api.acme.test/items/${id}`);
  const b = await fetch(`${API_BASE}/items/${id}`);
  const url = `${API_BASE}/items/${id}`;
  const c = await fetch(url);
  const d = await fetch('https://api.acme.test/ping');
  return a;
});
