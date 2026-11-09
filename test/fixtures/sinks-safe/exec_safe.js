import { execFile, execFileSync, spawn } from 'node:child_process';
// codex-supervisor style: argument arrays, never a shell string.
export function gitHead(cwd) {
  return execFileSync('git', ['-C', cwd, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
}
export function runTool(bin, args) {
  return spawn(bin, args, { stdio: 'inherit' }); // no shell:true
}
export async function probe(path) {
  return execFile('ffprobe', ['-i', path]);
}
