import { readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
export async function optionalJson(path: string): Promise<any | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; }
}
export async function project(dir: string) {
  dir = resolve(dir);
  if (!(await stat(dir)).isDirectory()) throw new Error(`Not a directory: ${dir}`);
  const pkg = await optionalJson(join(dir, 'package.json'));
  if (!pkg) throw new Error(`No package.json in ${dir}`);
  return { dir, pkg, manifest: await optionalJson(join(dir, 'manifest.json')), server: await optionalJson(join(dir, 'server.json')) };
}
export function message(e: unknown): string { return e instanceof Error ? e.message : String(e); }
