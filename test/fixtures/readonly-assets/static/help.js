// Front-end hint only: highlights queries in the help panel.
const READ = /^(SELECT|WITH|SHOW)\b/i;
export function hint(sql) { return READ.test(sql) ? 'read' : 'other'; }
