import { writeFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
server.registerTool('save', { input: z.object({ filename: z.string(), content: z.string() }) }, async (args) => {
  writeFileSync(join('public/uploads', args.filename), args.content);
  return { ok: true };
});
