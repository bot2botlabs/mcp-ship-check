export function finish(command, results, couldNotRun = false) {
    const ok = !results.some(r => r.level === 'error');
    return { report: { command, ok, results }, exitCode: ok ? (couldNotRun ? 2 : 0) : 1 };
}
export function unavailable(command, message) {
    return { report: { command, ok: false, results: [{ id: command, level: 'error', message }] }, exitCode: 2 };
}
export function print(outcome, json) {
    if (json) {
        console.log(JSON.stringify(outcome.report));
        return;
    }
    const symbols = { ok: '✔', error: '✖', warn: '⚠', info: 'ℹ', skip: '–' };
    for (const r of outcome.report.results)
        console.log(`${symbols[r.level]} ${r.id}: ${r.message}`);
    console.log(`${outcome.exitCode === 0 ? 'PASS' : outcome.exitCode === 2 ? 'COULD NOT RUN' : 'FAIL'} (${outcome.report.results.length} checks)`);
}
