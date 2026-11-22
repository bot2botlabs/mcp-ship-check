import { execSync } from 'child_process';
const TOOL = 'git';
export function blame(filePath: string) { return execSync(`git blame --line-porcelain "${filePath}"`); }
export function version() { return execSync(`${TOOL} --version`); }
export function listen(port: number) { return execSync(`lsof -ti :${port}`); }
