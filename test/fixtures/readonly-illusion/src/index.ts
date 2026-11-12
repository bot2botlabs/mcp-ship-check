import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const BLOCKED = /^\s*(INSERT|UPDATE|DELETE|DROP|ALTER)\b/i;
export async function runQuery(sql: string) {
  // only SELECT is allowed
  if (!sql.trim().toLowerCase().startsWith('select') || BLOCKED.test(sql)) throw new Error('read-only');
  return pool.query(sql);
}
