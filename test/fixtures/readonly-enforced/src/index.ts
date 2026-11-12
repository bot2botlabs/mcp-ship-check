import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export async function runQuery(sql: string) {
  if (!sql.trim().toLowerCase().startsWith('select')) throw new Error('SELECT only');
  const c = await pool.connect();
  try { await c.query('BEGIN TRANSACTION READ ONLY'); const r = await c.query(sql); await c.query('ROLLBACK'); return r; }
  finally { c.release(); }
}
