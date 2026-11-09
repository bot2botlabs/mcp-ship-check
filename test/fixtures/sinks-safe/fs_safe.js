import { resolve, relative } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
const BASE = resolve('/srv/workspace');
// kinocut style: resolve + base containment before any fs access.
function within(name) {
  const p = resolve(BASE, name);
  if (relative(BASE, p).startsWith('..')) throw new Error('path escapes base');
  return p;
}
export function read(name) { return readFileSync(within(name), 'utf8'); }
export function write(name, data) { return writeFileSync(within(name), data); }
