const ACTION_GROUPS = [
  ['changed', 'Changed', '\u001b[32m'],
  ['skipped', 'Skipped', '\u001b[36m'],
  ['warning', 'Warning', '\u001b[33m'],
  ['unknown', 'Unknown', '\u001b[35m'],
  ['failed', 'Failed', '\u001b[31m'],
];
const RESET = '\u001b[0m';

function styled(value, color, useColor) {
  return useColor ? `${color}${value}${RESET}` : value;
}

function renderItem(item, outcome, useColor) {
  const status = outcome ? styled(outcome, '\u001b[1m', useColor) : '';
  const reason = item.reason ? String(item.reason).replace(/\n/g, '\n    ') : '';
  const detail = outcome
    ? `: ${status}${reason ? ` — ${reason}` : ''}`
    : reason ? `: ${reason}` : '';
  return `  - ${item.name}${detail}`;
}

function renderGroup(lines, title, color, items, useColor, getOutcome) {
  if (items.length === 0) return;
  lines.push(`${styled(title, color, useColor)}:`);
  for (const item of items) lines.push(renderItem(item, getOutcome?.(item), useColor));
}

function renderResult(exitCode) {
  if (exitCode === 0) return 'Result: ok — exit 0 means the run completed successfully.';
  if (exitCode === 1) return 'Result: partial — exit 1 means a partial result or drift.';
  return 'Result: failed — exit 2 means a prerequisite or required item failed.';
}

export function renderExceptionsSummary(command, piPrerequisite, items, exitCode, useColor = false, dryRun = false) {
  const version = piPrerequisite.version ?? 'unknown';
  const piLine = piPrerequisite.ok
    ? `  Pi: ok (${piPrerequisite.version})`
    : `  Pi: failed — ${piPrerequisite.reason}`;
  const lines = [
    styled(`lemonpi ${command} — Pi ${version}${dryRun ? ' — dry run (nothing was changed)' : ''}`, '\u001b[1;36m', useColor),
    'Prerequisites:',
    piLine,
  ];

  const actionGroups = dryRun
    ? ACTION_GROUPS.map(([outcome, title, color]) => [
      outcome,
      outcome === 'changed' ? 'Would change' : outcome === 'skipped' ? 'Would skip' : title,
      color,
    ])
    : ACTION_GROUPS;
  for (const [outcome, title, color] of actionGroups) {
    renderGroup(
      lines,
      title,
      color,
      items.filter((item) => item.kind === 'action' && item.outcome === outcome),
      useColor,
    );
  }

  const okCount = items.filter((item) => item.kind === 'action' && item.outcome === 'ok').length;
  if (okCount > 0) lines.push(`OK: ${okCount} item${okCount === 1 ? '' : 's'}`);

  renderGroup(
    lines,
    'Notices',
    '\u001b[36m',
    items.filter((item) => item.kind === 'notice'),
    useColor,
  );
  renderGroup(
    lines,
    'Readiness',
    '\u001b[1;35m',
    items.filter((item) => item.kind === 'readiness'),
    useColor,
    (item) => item.outcome.charAt(0).toUpperCase() + item.outcome.slice(1),
  );
  lines.push(renderResult(exitCode));
  return `${lines.join('\n')}\n`;
}

export function renderInventorySummary(command, piPrerequisite, items, exitCode, useColor = false) {
  const version = piPrerequisite.version ?? 'unknown';
  const piLine = piPrerequisite.ok
    ? `  Pi: ok (${piPrerequisite.version})`
    : `  Pi: failed — ${piPrerequisite.reason}`;
  const lines = [
    styled(`lemonpi ${command} — Pi ${version}`, '\u001b[1;36m', useColor),
    'Prerequisites:',
    piLine,
  ];

  renderGroup(
    lines,
    'Inventory',
    '\u001b[1;36m',
    items.filter((item) => item.kind === 'inventory'),
    useColor,
    (item) => item.outcome,
  );
  renderGroup(
    lines,
    'Notices',
    '\u001b[36m',
    items.filter((item) => item.kind === 'notice'),
    useColor,
  );
  if (command === 'doctor') {
    renderGroup(
      lines,
      'Readiness',
      '\u001b[1;35m',
      items.filter((item) => item.kind === 'readiness'),
      useColor,
      (item) => item.outcome.charAt(0).toUpperCase() + item.outcome.slice(1),
    );
  }

  const resultLine = exitCode === 0
    ? 'Result: ok — exit 0 means the run completed successfully.'
    : exitCode === 1
      ? 'Result: partial — exit 1 means the inventory has drift.'
      : 'Result: failed — exit 2 means a prerequisite or inventory item failed.';
  lines.push(resultLine);
  return `${lines.join('\n')}\n`;
}

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
