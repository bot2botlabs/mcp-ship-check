import { writeFileSync } from 'fs';
import { z } from 'zod';
server.registerTool('save', { input: z.object({ filename: z.string(), id: z.string(), content: z.string() }) }, async (args) => {
  writeFileSync(`public/${args.filename}`.trim(), args.content);
  writeFileSync(`public/${args.id}.json`, args.content);
  return { ok: true };
});
