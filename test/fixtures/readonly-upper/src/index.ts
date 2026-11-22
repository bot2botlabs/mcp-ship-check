import mysql from 'mysql2/promise';
const BLOCKED = /^\s*(UPDATE|DELETE|REPLACE)\b/;
export async function run(conn: mysql.Connection, sql: string) {
  if (BLOCKED.test(sql.toUpperCase())) throw new Error('read-only');
  return conn.query(sql);
}
