const shippedFiles = [
  'agents/Explore.md',
  'agents/Plan.md',
  'agents/explorer.md',
  'agents/implementer.md',
  'agents/merger.md',
  'agents/researcher.md',
  'agents/reviewer.md',
  'agents/skeptic.md',
  'agents/transcript-auditor.md',
  'agents/verifier.md',
  'extensions/pi-footer.json',
  'subagents.json',
  'tasks-config.json',
];

export const ownedConfig = Object.freeze([
  Object.freeze({
    kind: 'default-model',
    name: 'default model (claude-code/claude-opus-5-5)',
    defaultProvider: 'claude-code',
    defaultModel: 'claude-opus-5-5',
  }),
  Object.freeze({
    kind: 'models-config',
    name: 'OpenAI models (models.json)',
    path: 'models.json',
  }),
  ...shippedFiles.map((path) => Object.freeze({
    kind: 'shipped-file',
    name: path,
    path,
    source: new URL(`./shipped-content/${path}`, import.meta.url),
  })),
]);
