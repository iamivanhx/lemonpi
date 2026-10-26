export function renderMinimalSummary(command, piPrerequisite, exitCode) {
  const version = piPrerequisite.version ?? 'unknown';
  const piLine = piPrerequisite.ok
    ? `  Pi: ok (${piPrerequisite.version})`
    : `  Pi: failed — ${piPrerequisite.reason}`;
  const resultLine = exitCode === 0
    ? 'Result: ok — exit 0 means the run completed successfully.'
    : 'Result: failed — exit 2 means a prerequisite failed.';

  return `lemonpi ${command} — Pi ${version}\nPrerequisites:\n${piLine}\n${resultLine}\n`;
}
