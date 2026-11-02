// Sources: https://developers.openai.com/api/docs/models and each model's page.
// API prices are Standard USD / million tokens, with 30-minute cache writes.
// Keep subscription context limits separate from public API specifications.
const specs = [
  ['gpt-6-astra', 'GPT-6 Astra', false, 10, 50, 1, 12.5],
  ['gpt-6.1-sol', 'GPT-6.1 Sol', false, 2, 10, 0.1, 2.5],
  ['gpt-6.1-terra', 'GPT-6.1 Terra', true, 1, 5, 0.05, 1.25],
  ['gpt-6-luna', 'GPT-6 Luna', true, 0.1, 0.5, 0.01, 0.125],
];

function metadata([id, name, supportsNone, input, output, cacheRead, cacheWrite], contextWindow) {
  return {
    id,
    name,
    reasoning: true,
    input: ['text', 'image'],
    contextWindow,
    maxTokens: 128000,
    thinkingLevelMap: {
      off: supportsNone ? 'none' : null,
      minimal: null,
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: 'max',
    },
    cost: {
      input, output, cacheRead, cacheWrite,
      tiers: [{
        inputTokensAbove: 272000,
        input: input * 2,
        output: output * 1.5,
        cacheRead: cacheRead * 2,
        cacheWrite: cacheWrite * 2,
      }],
    },
  };
}

// Codex windows: Sol's model page specifies 500K, and Pi 1.5.0 ships Terra at
// 500K. Retain Pi's conservative 272K for the others; the API's 1.05M is not a
// subscription guarantee.
const CODEX_CONTEXT_WINDOWS = { 'gpt-6.1-sol': 500000, 'gpt-6.1-terra': 500000 };

function provider(subscription) {
  const modelOverrides = {};
  for (const spec of specs) {
    const id = spec[0];
    const contextWindow = subscription ? (CODEX_CONTEXT_WINDOWS[id] ?? 272000) : 1050000;
    const { id: _id, ...override } = metadata(spec, contextWindow);
    // Override metadata only, so every model keeps the catalog's transport,
    // compatibility flags and image limits (Pi 1.5.0 bundles all four).
    modelOverrides[id] = override;
  }
  return { modelOverrides };
}

export const openaiModels = {
  providers: {
    openai: provider(false),
    'openai-codex': provider(true),
  },
};
