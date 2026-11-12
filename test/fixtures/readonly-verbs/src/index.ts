import Database from 'better-sqlite3';
const db = new Database(':memory:');
const WRITE_ACTIONS = ['create', 'update', 'delete'];
export const readOnly = process.env.ACME_READ_ONLY === '1';
export function allowed(action: string) { return !(readOnly && WRITE_ACTIONS.includes(action)); }
export { db };
