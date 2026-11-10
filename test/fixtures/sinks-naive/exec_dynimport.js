import os from 'node:os';
// dynamic import of child_process — must still be detected.
export async function run(userCmd) {
  const { exec } = await import('node:child_process');
  return exec(`do ${userCmd}`);
}
