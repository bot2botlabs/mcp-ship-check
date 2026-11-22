import { readFileSync, writeFileSync } from 'node:fs';
export class Store {
  constructor(private filePath: string) {}
  load(target: string) { return readFileSync(target, 'utf8'); }
  save(dest: string, v: string) { writeFileSync(dest, v); }
}
