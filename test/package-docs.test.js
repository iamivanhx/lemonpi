import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const packages = [
  ['subagents', 'npm:@tintinweb/pi-subagents', 'Required'],
  ['review', 'git:github.com/earendil-works/pi-review', 'Required'],
  ['todo', 'npm:@juicesharp/rpiv-todo', 'Required'],
  ['claude-code', 'git:github.com/earendil-works/pi-claude-code', 'Required'],
  ['ask-user', 'npm:@juicesharp/rpiv-ask-user-question', 'Optional'],
  ['web-access', 'npm:pi-web-access', 'Optional'],
  ['footer', 'npm:pi-footer', 'Optional'],
  ['pretty', 'npm:@heyhuynhgiabuu/pi-pretty', 'Optional'],
];

async function readPackagesSection() {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const start = readme.indexOf('## Packages');
  assert.notEqual(start, -1, 'README has a Packages section');
  const end = readme.indexOf('\n## ', start + '## Packages'.length);
  return { readme, section: readme.slice(start, end === -1 ? undefined : end) };
}

async function readOwnedConfigSection() {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const start = readme.indexOf('## Owned config');
  assert.notEqual(start, -1, 'README has an Owned config section');
  const end = readme.indexOf('\n## ', start + '## Owned config'.length);
  return readme.slice(start, end === -1 ? undefined : end);
}

test('README documents the built package scope without claiming later areas are built', async () => {
  const { readme } = await readPackagesSection();

  assert.match(readme, /Current scope — Areas 1–3/);
  assert.match(readme, /Private skills and Readiness are not implemented yet/i);
  assert.match(readme, /Owned config(?:uration)?[\s\S]*Private skills[\s\S]*Readiness[\s\S]*not implemented/i);
  assert.doesNotMatch(readme, /Current scope — Areas 1–2/);
  assert.doesNotMatch(readme, /Placeholder — Area 3/i);
});

test('README Owned config section documents ownership and restore behavior', async () => {
  const section = await readOwnedConfigSection();

  assert.ok(section.includes('default model `claude-code/claude-opus-5-5`'), 'names the owned default model');
  assert.ok(section.includes('`defaultProvider` and `defaultModel`'), 'limits the model setting ownership');
  for (const path of [
    'settings.json',
    'agents/explorer.md',
    'agents/implementer.md',
    'agents/merger.md',
    'agents/researcher.md',
    'agents/reviewer.md',
    'extensions/pi-footer.json',
  ]) {
    assert.ok(section.includes(`\`${path}\``), `names owned path ${path}`);
  }
  assert.ok(section.includes('Every other setting and file is never touched or reported'), 'excludes all other settings and files');
  assert.ok(section.includes('`install` and `update` restore owned items without asking'), 'documents automatic install and update restores');
  assert.ok(section.includes('`status` reports them as **Drift**'), 'documents Drift in status');
  assert.ok(section.includes('without showing a diff'), 'documents that status shows no diff');
  assert.ok(section.includes("pi-footer's `/footer` UI"), 'identifies the footer UI as a source of edits');
  assert.ok(section.includes('editing the agent files'), 'identifies agent-file edits');
  assert.ok(section.includes('are reverted by the next `install` or `update`'), 'documents restore of local edits');
  assert.ok(section.includes('<agentDir>/lemonpi-backups/<timestamp>/'), 'documents the backup location');
  assert.ok(section.includes('Before rewriting an existing file that differs'), 'limits backups to differing existing files');
  assert.ok(section.includes('one folder per run'), 'documents one backup folder per run');
  assert.ok(section.includes('Backups are never pruned or printed'), 'documents backup retention and output');
  assert.ok(section.includes('Symlinked files are written through and the link is kept'), 'documents symlink handling');
  assert.ok(section.includes('Files lemonpi stops shipping stay as your files'), 'documents files no longer shipped');
  assert.ok(section.includes('`--skip footer` holds back only the package, not its config'), 'documents footer skip scope');
  assert.doesNotMatch(section, /Placeholder — Area 3/i, 'removes the Area 3 placeholder');
});

test('README Packages section lists the catalog and its reconciliation promises', async () => {
  const { section } = await readPackagesSection();

  assert.doesNotMatch(section, /Placeholder — Area 2/i);
  for (const [id, source, requiredness] of packages) {
    assert.ok(
      section.includes(`| \`${id}\` | \`${source}\` | ${requiredness} |`),
      `catalog table lists ${id}, ${source}, and ${requiredness.toLowerCase()}`,
    );
  }

  for (const promise of [
    '**Managed package**',
    '**Unmanaged package**',
    '**Replaced package**',
    '**Drift**',
    '**Notice**',
    '**Skipped**',
    'installs missing Managed packages',
    'unpins pinned declarations',
    'npm:pi-subagents',
    'installs the replacement if needed, verifies its declaration',
    'already-present unpinned Managed packages are left alone',
    'one package at a time',
    '`--skip <id,…>`',
    'unknown ID is a usage error and exits 2',
    'failed Required package fails the run (exit 2)',
    'failed Optional package makes it partial (exit 1)',
    'usage error',
    'never a failure',
    'missing',
    'pinned',
    'duplicated',
    'migration',
    'project settings',
    'global Pi settings',
    'lemonpi never tests package releases',
    'never downgrades to an older release',
    'pi remove',
    '`claude` CLI',
    'never installs the `claude` CLI or Claude Code',
    'no provider configuration or credentials',
    'already-declared replacement',
    'does not transfer',
  ]) {
    assert.ok(section.includes(promise), `Packages section covers ${promise}`);
  }
});
