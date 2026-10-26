import packageJson from '../package.json' with { type: 'json' };

const BUILT_IN_PARTS = Object.freeze([]);
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

export async function run(argv, host, options = {}) {
  const parts = options.parts ?? BUILT_IN_PARTS;
  void parts;

  if (argv.includes('--version')) {
    host.stdout.write(`${packageJson.version}\n`);
    return 0;
  }

  if (argv.includes('--help') || argv.includes('-h')) {
    host.stdout.write(USAGE);
    return 0;
  }

  return 0;
}
