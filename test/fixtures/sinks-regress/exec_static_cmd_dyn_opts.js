import { execSync } from 'node:child_process';
// Static command; the DYNAMIC part is the options object (input/cwd), not the
// command. Must NOT be flagged (static-command-with-dynamic-options false positive).
export function gitIgnored(repo, paths) {
  return execSync('git check-ignore --stdin -z', { cwd: repo, input: paths.join('\0') + '\0' });
}
export function withCb(dir) {
  return execSync('ls -la', { cwd: dir });
}
