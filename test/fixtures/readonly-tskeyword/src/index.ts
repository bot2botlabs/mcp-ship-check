import Database from 'better-sqlite3';
interface Opts { readonly path: string; readonly verbose: boolean }
class Store { readonly db: Database.Database; constructor(o: Opts) { this.db = new Database(o.path); } }
export function query(s: Store, sql: string) {
  if (!/^\s*select\b/i.test(sql)) throw new Error('read-only');
  return s.db.prepare(sql).all();
}
