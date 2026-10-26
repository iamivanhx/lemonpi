import { join } from 'node:path';
import { parseArgs } from 'node:util';
import packageJson from '../package.json' with { type: 'json' };
import { checkPrerequisites } from './prerequisites.js';
import { renderExceptionsSummary, renderInventorySummary, renderMinimalSummary } from './summary.js';
import { packageIds } from './packages/catalog.js';
import { packagesPart } from './packages/part.js';
import { ownedConfigPart } from './owned-config/part.js';

const BUILT_IN_PARTS = Object.freeze([packagesPart, ownedConfigPart]);
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

function interruptedExitCode(signal) {
  return signal.reason === 'SIGTERM' ? 143 : 130;
}

function exitCodeFor(items, dryRun = false) {
  const failedPrerequisiteOrUsage = items.some((item) => (
    item.kind === 'usage' || (item.kind === 'prerequisite' && item.outcome === 'failed')
  ));
  if (failedPrerequisiteOrUsage) return 2;
  if (dryRun) return 0;

  const failedRequiredActionOrInventory = items.some((item) => (
    (item.kind === 'action' && item.outcome === 'failed' && item.required === true)
    || (item.kind === 'inventory' && item.outcome === 'failed')
  ));
  if (failedRequiredActionOrInventory) return 2;

  const failedOptionalActionOrDrift = items.some((item) => (
    (item.kind === 'action' && item.outcome === 'failed' && item.required === false)
    || (item.kind === 'inventory' && item.outcome === 'drift')
  ));
  if (failedOptionalActionOrDrift) return 1;
  return 0;
}

function usageError(host, message) {
  host.stderr.write(`lemonpi: ${message}; run \`lemonpi --help\` for usage\n`);
  return exitCodeFor([{ kind: 'usage', outcome: 'invalid' }]);
}

function parseErrorMessage(error) {
  switch (error.code) {
    case 'ERR_PARSE_ARGS_UNKNOWN_OPTION':
    case 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE': {
      // Node's text is only displayed, never used to identify the failure.
      const firstLine = error.message.split('\n', 1)[0].replace(/\.$/, '');
      return firstLine.charAt(0).toLowerCase() + firstLine.slice(1);
    }
    default:
      throw error;
  }
}

export async function run(argv, host, options = {}) {
  const parts = options.parts ?? BUILT_IN_PARTS;

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
    // Translate only known user-input errors at the argv boundary; unexpected
    // failures (including invalid parser inputs/configuration) are rethrown.
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
    skip: parsed.values.skip === undefined ? [] : parsed.values.skip.split(',').map((id) => id.trim()),
    skipSkills: parsed.values['skip-skills'] ?? false,
  };
  const unknownSkip = flags.skip.find((id) => !packageIds.includes(id));
  if (unknownSkip !== undefined) {
    return usageError(
      host,
      `unknown package id '${unknownSkip}' for --skip; valid ids: ${packageIds.join(', ')}`,
    );
  }
  const dryRun = parsed.values['dry-run'] ?? false;

  const prerequisites = host.signal.aborted
    ? {
      ok: false,
      type: 'interrupted',
      pi: { ok: false, version: null, reason: 'interrupted before the prerequisite check completed' },
    }
    : await checkPrerequisites(host);
  if (!prerequisites.ok && prerequisites.type === 'refusal') {
    host.stderr.write(`${prerequisites.message}\n`);
    return exitCodeFor([{ kind: 'prerequisite', outcome: 'failed' }]);
  }

  const interruptedPrerequisite = host.signal.aborted && !prerequisites.ok;
  const piPrerequisite = interruptedPrerequisite
    ? {
      ...prerequisites.pi,
      reason: 'interrupted before the prerequisite check completed',
      interrupted: true,
    }
    : prerequisites.pi;
  const items = prerequisites.ok
    ? []
    : [{ name: 'Pi', kind: 'prerequisite', outcome: 'failed', reason: piPrerequisite.reason }];
  if (prerequisites.ok) {
    const context = {
      command,
      flags,
      dryRun,
      env: host.env,
      agentDir: host.env.PI_CODING_AGENT_DIR ?? join(host.env.HOME, '.pi', 'agent'),
      cwd: host.cwd,
      tmpdir: host.tmpdir,
      readFile: host.readFile,
      readBytes: host.readBytes,
      lstat: host.lstat,
      stat: host.stat,
      realpath: host.realpath,
      mkdir: host.mkdir,
      writeFile: host.writeFile,
      rename: host.rename,
      rm: host.rm,
      chmod: host.chmod,
      now: host.now,
      piVersion: prerequisites.pi.version,
      runner: host.runner,
      signal: host.signal,
    };
    for (const part of parts) {
      if (host.signal.aborted) break;
      if (part.commands.includes(command)) {
        try {
          items.push(...await part.run(context));
        } catch {
          // A part is a run boundary: report failure and continue other parts.
          // Do not echo thrown messages, which may contain credential material.
          const action = ['install', 'update', 'skills'].includes(command);
          items.push({
            name: part.name,
            kind: action ? 'action' : 'inventory',
            outcome: 'failed',
            reason: 'part failed unexpectedly',
            ...(action ? { required: true } : {}),
          });
        }
      }
    }
  }

  const interrupted = host.signal.aborted;
  const exitCode = interrupted ? interruptedExitCode(host.signal) : exitCodeFor(items, dryRun);
  const useColor = host.stdout.isTTY === true && host.env.NO_COLOR === undefined;
  const summary = ['install', 'update', 'skills'].includes(command)
    ? renderExceptionsSummary(command, piPrerequisite, items, exitCode, useColor, dryRun, interrupted)
    : prerequisites.ok && parts.some((part) => part.commands.includes(command))
      ? renderInventorySummary(command, piPrerequisite, items, exitCode, useColor, interrupted)
      : renderMinimalSummary(command, piPrerequisite, exitCode, interrupted);
  host.stdout.write(summary);
  return exitCode;
}
