import { execFile } from 'node:child_process';
// RegExp.prototype.exec must NOT be flagged as child_process.exec
export function tag(url) {
  const m = /\/tag\/(v\d+\.\d+\.\d+)$/.exec(String(url || ''));
  return m ? m[1] : null;
}
export function major(s) {
  const re = /^(\d+)\.(\d+)/;
  return re.exec(s)?.[1];
}
export function run(bin, args) { return execFile(bin, args); } // safe, argv array
