import { Pool } from 'pg';
export const pool = new Pool();
export const readOnly = process.env.ACME_VIEWER === '1';
// Commit subjects and volume verbs, not SQL.
export function isRemoval(subject: string) { return subject.startsWith('Delete') || /^(Replace|Merge)\b/.test(subject); }
export const VOLUME_ACTIONS = ['attach', 'detach'];
export const BRANCH_ACTIONS = ['merge', 'replace'];
