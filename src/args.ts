export interface Args { command?: string; dir: string; json: boolean; help: boolean; version: boolean; cmd?: string; timeout: number; env: Record<string, string>; glama: boolean; glamaUrl?: string }
export function parseArgs(argv: string[]): Args {
  const args: Args = { dir: '.', json: false, help: false, version: false, timeout: 15000, env: {}, glama: true };
  let hasDir = false; const used: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const value = () => { const v = argv[++i]; if (v === undefined || v.startsWith('--')) throw new Error(`${token} needs a value`); return v; };
    if (token === '--json') args.json = true;
    else if (token === '--help' || token === '-h') args.help = true;
    else if (token === '--version') args.version = true;
    else if (token === '--cmd') { args.cmd = value(); used.push(token); }
    else if (token === '--timeout') { args.timeout = Number(value()); if (!Number.isSafeInteger(args.timeout) || args.timeout <= 0) throw new Error('--timeout must be a positive integer'); used.push(token); }
    else if (token === '--env') { const v = value(), n = v.indexOf('='); if (n < 1) throw new Error('--env needs KEY=VAL'); args.env[v.slice(0, n)] = v.slice(n + 1); used.push(token); }
    else if (token === '--no-glama') { args.glama = false; used.push(token); }
    else if (token === '--glama-url') { args.glamaUrl = value(); used.push(token); }
    else if (token.startsWith('-')) throw new Error(`Unknown option ${token}`);
    else if (!args.command) { if (!['files', 'tools', 'published'].includes(token)) throw new Error(`Unknown command ${token}`); args.command = token; }
    else if (!hasDir) { args.dir = token; hasDir = true; }
    else throw new Error(`Unexpected argument ${token}`);
  }
  if (!args.help && !args.version) {
    if (!args.command) throw new Error('Expected files, tools, or published; use --help');
    for (const flag of used) if (!(args.command === 'tools' ? ['--cmd', '--timeout', '--env'] : args.command === 'published' ? ['--timeout', '--no-glama', '--glama-url'] : []).includes(flag)) throw new Error(`${flag} is not supported by ${args.command}`);
  }
  return args;
}
