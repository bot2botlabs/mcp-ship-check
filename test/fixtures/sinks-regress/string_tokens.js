// Linter rule strings mentioning exec/fs must not be flagged as calls.
export const RULES = ['exec(', 'execSync(', 'child_process.exec(', 'fs.readFileSync('];
export const DOC = "example: exec(`rm ${x}`) is dangerous";
