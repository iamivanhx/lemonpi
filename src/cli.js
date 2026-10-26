import { parseArgs } from 'node:util';
import packageJson from '../package.json' with { type: 'json' };
import { checkPrerequisites } from './prerequisites.js';
import { renderMinimalSummary } from './summary.js';

const BUILT_IN_PARTS = Object.freeze([]);
const COMMANDS = new Set(['install', 'update', 'status', 'doctor', 'skills']);
const COMMAND_FLAGS = {
  install: ['--dry-run', '--skip', '--skip-skills'],
  update: ['--dry-run', '--skip', '--skip-skills'],
  status: ['--skip'],
  doctor: ['--skip', '--skip-skills'],
  skills: ['--dry-run'],
};
const ARGUMENT_OPTIONS = {
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  skip: { type: 'string' },
  'skip-skills': { type: 'boolean' },
};
const USAGE = `Usage: lemonpi [command] [options]

Commands:
  install (default)  Configure the declared Pi setup
  update             Update the declared Pi setup
  status             Show setup drift and notices
  doctor             Show setup status and readiness
  skills             Install or update private skills

Options:
  --help, -h         Show usage (all commands)
  --version          Show version (all commands)
  --dry-run          Preview changes; accepted by install, update, skills
  --skip <id,…>      Skip package IDs; accepted by install, update, status, doctor
  --skip-skills      Skip private skills; accepted by install, update, doctor

Exit codes:
  0    ok
  1    partial result or drift
  2    failed
  130  interrupted by SIGINT (Ctrl-C)
  143  interrupted by SIGTERM
`;

function usageError(host, message) {
  host.stderr.write(`lemonpi: ${message}; run \`lemonpi --help\` for usage\n`);
  return 2;
}

function parseErrorMessage(error) {
  const unknownOption = /^Unknown option '([^']+)'/.exec(error.message);
  if (unknownOption) return `unknown option '${unknownOption[1]}'`;

  const missingValue = /^Option '([^']+)' argument missing/.exec(error.message);
  if (missingValue) return `missing value for ${missingValue[1].split(' ')[0]}`;

  const firstLine = error.message.split('\n', 1)[0].replace(/\.$/, '');
  return `invalid arguments: ${firstLine}`;
}

export async function run(argv, host, options = {}) {
  const parts = options.parts ?? BUILT_IN_PARTS;
  void parts;

  if (argv.includes('--help') || argv.includes('-h')) {
    host.stdout.write(USAGE);
    return 0;
  }

  if (argv.includes('--version')) {
    host.stdout.write(`${packageJson.version}\n`);
    return 0;
  }

  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: ARGUMENT_OPTIONS, strict: true, allowPositionals: true });
  } catch (error) {
    return usageError(host, parseErrorMessage(error));
  }

  const command = parsed.positionals[0] ?? 'install';
  if (!COMMANDS.has(command)) {
    return usageError(host, `unknown command '${command}'`);
  }
  if (parsed.positionals.length > 1) {
    return usageError(host, `unexpected argument '${parsed.positionals[1]}'`);
  }

  const suppliedFlags = [
    ['--dry-run', Object.hasOwn(parsed.values, 'dry-run')],
    ['--skip', Object.hasOwn(parsed.values, 'skip')],
    ['--skip-skills', Object.hasOwn(parsed.values, 'skip-skills')],
  ];
  const unsupportedFlag = suppliedFlags.find(([flag, supplied]) => supplied && !COMMAND_FLAGS[command].includes(flag));
  if (unsupportedFlag) {
    return usageError(host, `option '${unsupportedFlag[0]}' is not valid for command '${command}'`);
  }

  if (parsed.values.skip === '') {
    return usageError(host, 'missing value for --skip');
  }

  const flags = {
    dryRun: parsed.values['dry-run'] ?? false,
    skip: parsed.values.skip === undefined ? [] : parsed.values.skip.split(','),
    skipSkills: parsed.values['skip-skills'] ?? false,
  };
  void flags;

  const prerequisites = await checkPrerequisites(host);
  if (!prerequisites.ok && prerequisites.type === 'refusal') {
    host.stderr.write(`${prerequisites.message}\n`);
    return 2;
  }

  const exitCode = prerequisites.ok ? 0 : 2;
  host.stdout.write(renderMinimalSummary(command, prerequisites.pi, exitCode));
  return exitCode;
}
