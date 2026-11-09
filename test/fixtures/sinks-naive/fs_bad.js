import fs from 'node:fs';
// variable path, no resolve()/base-prefix guard anywhere in this file
export function readAny(userPath) {
  return fs.readFileSync(userPath, 'utf8');
}
