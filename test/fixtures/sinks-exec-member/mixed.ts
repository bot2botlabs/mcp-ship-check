import { exec } from 'node:child_process';
import * as cp from 'node:child_process';
const db = getDb();
const re = /x(\d+)/g;
export const q = (sql: string) => db.exec(sql);        // L5: member-access, NOT flagged
export const p = (s: string) => re.exec(s);            // L6: RegExp, NOT flagged
export const shell = (c: string) => exec(c);           // L7: genuine child_process.exec, FLAGGED
export const nsShell = (c: string) => cp.exec(c);      // L8: namespace child_process.exec, FLAGGED
