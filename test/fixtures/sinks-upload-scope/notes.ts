import { writeFile } from 'fs/promises';
import { z } from 'zod';
server.registerTool('write_note', { input: z.object({ filePath: z.string(), content: z.string() }) }, async (args) => {
  await writeFile(args.filePath, args.content);
  return { ok: true };
});
