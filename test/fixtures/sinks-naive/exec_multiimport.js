import { readFileSync } from 'node:fs';
import path from 'node:path';
import { exec, spawn } from 'node:child_process';
// child_process is the THIRD import — must still be detected.
export function run(userCmd) { return exec(`process ${userCmd}`); }
export function sh(cmd) { return spawn('bash', ['-c', cmd], { shell: true }); }
