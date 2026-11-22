import { readFile } from 'node:fs/promises';
export async function readNote(filePath: string) {
  return readFile(filePath, 'utf8');
}
