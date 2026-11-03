#!/usr/bin/env node
import { parseArgs } from './args.js';
import { files } from './commands/files.js';
import { tools } from './commands/tools.js';
import { published } from './commands/published.js';
import { print, unavailable } from './report.js';
import { version } from './version.js';
try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) console.log('Usage: mcp-ship-check <files|tools|published> [dir] [--json]\n tools: [--cmd "node dist/index.js"] [--timeout 15000] [--env KEY=VAL ...]\n published: [--no-glama] [--glama-url URL] [--timeout 15000]\nGlobal: --help --version');
  else if (args.version) console.log(version);
  else { const result = await (args.command === 'files' ? files(args.dir) : args.command === 'tools' ? tools(args.dir, args) : published(args.dir, args)); print(result, args.json); process.exitCode = result.exitCode; }
} catch (e) { print(unavailable(process.argv.slice(2).find(s => ['files', 'tools', 'published'].includes(s)) ?? 'cli', e instanceof Error ? e.message : String(e)), process.argv.includes('--json')); process.exitCode = 2; }
