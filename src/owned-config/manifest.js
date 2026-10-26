const shippedFiles = [
  'agents/explorer.md',
  'agents/implementer.md',
  'agents/merger.md',
  'agents/researcher.md',
  'agents/reviewer.md',
  'extensions/pi-footer.json',
];

export const ownedConfig = Object.freeze([
  Object.freeze({
    kind: 'default-model',
    name: 'default model (claude-code/claude-opus-5-5)',
    defaultProvider: 'claude-code',
    defaultModel: 'claude-opus-5-5',
  }),
  ...shippedFiles.map((path) => Object.freeze({
    kind: 'shipped-file',
    name: path,
    path,
    source: new URL(`./shipped-content/${path}`, import.meta.url),
  })),
]);
