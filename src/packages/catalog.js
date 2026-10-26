const entries = [
  {
    id: 'subagents',
    source: 'npm:@tintinweb/pi-subagents',
    required: true,
    replaces: ['npm:pi-subagents'],
    alternatives: ['git:github.com/tintinweb/pi-subagents'],
  },
  {
    id: 'review',
    source: 'git:github.com/earendil-works/pi-review',
    required: true,
    alternatives: [],
  },
  {
    id: 'todo',
    source: 'npm:@juicesharp/rpiv-todo',
    required: true,
    alternatives: ['git:github.com/juicesharp/rpiv-mono'],
  },
  {
    id: 'claude-code',
    source: 'git:github.com/earendil-works/pi-claude-code',
    required: true,
    alternatives: [],
  },
  {
    id: 'ask-user',
    source: 'npm:@juicesharp/rpiv-ask-user-question',
    required: false,
    alternatives: ['git:github.com/juicesharp/rpiv-mono'],
  },
  {
    id: 'web-access',
    source: 'npm:pi-web-access',
    required: false,
    alternatives: ['git:github.com/nicobailon/pi-web-access'],
  },
  {
    id: 'footer',
    source: 'npm:pi-footer',
    required: false,
    alternatives: ['git:github.com/wobondar/pi-footer'],
  },
  {
    id: 'pretty',
    source: 'npm:@heyhuynhgiabuu/pi-pretty',
    required: false,
    alternatives: ['git:github.com/heyhuynhgiabuu/pi-pretty'],
  },
];

export const catalog = Object.freeze(entries.map((entry) => Object.freeze({
  ...entry,
  ...(entry.replaces ? { replaces: Object.freeze([...entry.replaces]) } : {}),
  alternatives: Object.freeze([...entry.alternatives]),
})));

export const packageIds = Object.freeze(catalog.map(({ id }) => id));
