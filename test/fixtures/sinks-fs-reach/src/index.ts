import { z } from 'zod';
import { readNote } from './notes.js';
server.registerTool('read', { inputSchema: { name: z.string() } }, async ({ name }) => readNote(name));
