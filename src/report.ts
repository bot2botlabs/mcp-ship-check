export type Level = 'error' | 'warn' | 'info' | 'ok' | 'skip';
export interface Result { id: string; level: Level; message: string; details?: unknown }
export interface Report { command: string; ok: boolean; results: Result[] }
export interface Outcome { report: Report; exitCode: number }
export function finish(command: string, results: Result[], couldNotRun = false): Outcome {
  const ok = !results.some(r => r.level === 'error');
  return { report: { command, ok, results }, exitCode: ok ? (couldNotRun ? 2 : 0) : 1 };
}
export function unavailable(command: string, message: string): Outcome {
  return { report: { command, ok: false, results: [{ id: command, level: 'error', message }] }, exitCode: 2 };
}
export function print(outcome: Outcome, json: boolean): void {
  if (json) { console.log(JSON.stringify(outcome.report)); return; }
  const symbols = { ok: '✔', error: '✖', warn: '⚠', info: 'ℹ', skip: '–' };
  for (const r of outcome.report.results) console.log(`${symbols[r.level]} ${r.id}: ${r.message}`);
  console.log(`${outcome.exitCode === 0 ? 'PASS' : outcome.exitCode === 2 ? 'COULD NOT RUN' : 'FAIL'} (${outcome.report.results.length} checks)`);
}
