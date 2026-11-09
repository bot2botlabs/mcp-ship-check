import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
// A homedir/config read is not an externally-derived path.
export function loadConfig() {
  return readFileSync(join(homedir(), '.myapp', 'config.json'), 'utf8');
}
