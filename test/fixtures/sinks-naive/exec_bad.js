import { exec, spawn } from 'node:child_process';
export function convert(userPath) {
  // interpolated command into a shell
  return exec(`ffmpeg -i ${userPath} out.mp4`);
}
export function danger(cmd) {
  return spawn('bash', ['-c', cmd], { shell: true });
}
