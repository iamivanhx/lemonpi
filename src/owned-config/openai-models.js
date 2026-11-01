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

function provider(subscription) {
  const modelOverrides = {};
  const models = [];
  for (const spec of specs) {
    const id = spec[0];
    // Sol's model page specifies 500K in Codex. Retain Pi's conservative
    // 272K for the others; the API's 1.05M is not a subscription guarantee.
    const contextWindow = subscription ? (id === 'gpt-6.1-sol' ? 500000 : 272000) : 1050000;
    const { id: modelId, ...override } = metadata(spec, contextWindow);
    // Also override matching user definitions, without dropping extra fields.
    modelOverrides[id] = override;
    if (id === 'gpt-6.1-terra') {
      // Terra is absent from Pi 1.4.0's bundled catalog. Use a model-level
      // transport, inheriting the provider URL and authentication.
      models.push({
        id: modelId,
        ...override,
        api: subscription ? 'openai-codex-responses' : 'openai-responses',
        compat: {
          supportsStrictMode: true,
          ...(!subscription ? { supportsExplicitPromptCacheMode: true } : {}),
        },
      });
    }
    // Other models retain catalog compatibility flags and image limits.
  }
  return { modelOverrides, models };
}

export const openaiModels = {
  providers: {
    openai: provider(false),
    'openai-codex': provider(true),
  },
};
