import { exec } from 'node:child_process';
// A regex literal containing quotes must NOT poison string spans for the
// lines below it (v2.4 marked the rest of the file as "inside a string").
export function parse(s) {
  const m = /it's a "quoted" value/.exec(String(s));
  return m ? m[0] : null;
}
export function run(userCmd) { return exec(`do ${userCmd}`); } // must still be caught
