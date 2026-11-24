import { writeFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
server.registerResource('readme', 'note://readme', async () => ({ contents: [{ uri: 'note://readme', mimeType: 'text/plain', text: 'hi' }] }));
async function lookup(u) { return fetch(u, { headers: { accept: 'application/json' } }); }
server.registerTool('save', { input: z.object({ filename: z.string(), content: z.string() }) }, async (args) => {
  writeFileSync(join('public/uploads', args.filename), args.content);
  return { ok: true };
});
