import { exec } from 'node:child_process';   // in scope, but only used safely below
import Database from 'duckdb';
const db = new Database(':memory:');
const re = /row-(\d+)/g;
export function query(sql: string) { return db.exec(sql); }   // DuckDB method, not child_process
export function parse(s: string) { return re.exec(s); }       // RegExp.exec, not child_process
export function safeSpawn() { void exec; }                    // reference only, never invoked
