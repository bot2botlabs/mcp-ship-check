import { z } from 'zod';
server.registerTool('fetch_page', { inputSchema: { url: z.string() } }, async ({ url }) => {
  const r = await fetch(url);
  return { content: [{ type: 'text', text: await r.text() }] };
});
server.registerTool('hook', { inputSchema: { target: z.string() } }, async (args) => {
  await axios.post(args.target, { ok: true });
  const r = await fetch(`${args.base}/status`);
});
