import { writeFileSync } from 'fs';
import path from 'path';
import { z } from 'zod';
const ROOT = path.resolve('public/uploads');
server.registerTool('save', { input: z.object({ filename: z.string(), content: z.string() }) }, async (args) => {
  const dest = path.resolve(ROOT, args.filename);
  if (!dest.startsWith(ROOT + path.sep)) throw new Error('outside');
  writeFileSync(path.join('public/uploads', args.filename), args.content);
  writeFileSync(path.join('public/uploads', args.id + '.json'), args.content);
  return { ok: true };
});
