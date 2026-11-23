import { writeFileSync } from 'fs';
import { join, basename, extname } from 'path';
import { z } from 'zod';
const ALLOWED = ['.png', '.jpg'];
server.registerTool('save', { input: z.object({ filename: z.string(), content: z.string() }) }, async (args) => {
  if (!ALLOWED.includes(extname(args.filename))) throw new Error('bad type');
  writeFileSync(join('data', basename(args.filename)), args.content);
  return { ok: true };
});
