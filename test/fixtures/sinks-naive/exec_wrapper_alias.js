import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const execAsync = promisify(exec);                 // alias of exec
export async function a(userCmd) { return execAsync(`run ${userCmd}`); }  // must be caught
function execPromise(cmd) {                          // thin wrapper around exec
  return new Promise((res, rej) => exec(cmd, (e, o) => (e ? rej(e) : res(o))));
}
export function b(ns) { return execPromise(`kubectl get pods --namespace ${ns}`); } // must be caught
