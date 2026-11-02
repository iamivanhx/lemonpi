import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
import { openaiModels } from './openai-models.js';
import { writeOwnedFile } from './writer.js';

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Model definitions an earlier lemonpi wrote and no longer ships. A `models`
// entry replaces the catalog model with the same ID, so a leftover entry would
// hide the richer built-in one. Pi 1.5.0 bundles GPT-6.1 Terra.
const RETIRED_MODELS = {
  openai: ['gpt-6.1-terra'],
  'openai-codex': ['gpt-6.1-terra'],
};
const RETIRED_MODEL_FIELDS = new Set([
  'id', 'name', 'reasoning', 'input', 'contextWindow', 'maxTokens', 'thinkingLevelMap', 'cost', 'api', 'compat',
]);

function validModels(models) {
  if (!Array.isArray(models) || models.some((model) => !object(model) || typeof model.id !== 'string')) {
    throw new TypeError('Expected model definitions');
  }
  const ids = models.map((model) => model.id);
  if (new Set(ids).size !== ids.length) throw new TypeError('Duplicate model IDs');
}

// Remove a retired entry only when it holds nothing but fields lemonpi wrote;
// an entry with any other field is the user's and stays.
function retireModels(existing) {
  if (!object(existing.providers)) return existing;
  // A managed provider's models list must be valid, even with nothing to merge.
  for (const providerId of Object.keys(RETIRED_MODELS)) {
    const config = existing.providers[providerId];
    if (object(config) && Object.hasOwn(config, 'models')) validModels(config.models);
  }
  let providers = existing.providers;
  for (const [providerId, ids] of Object.entries(RETIRED_MODELS)) {
    const config = providers[providerId];
    if (!object(config) || !Array.isArray(config.models)) continue;
    const kept = config.models.filter((model) => !(object(model) && ids.includes(model.id)
      && Object.keys(model).every((key) => RETIRED_MODEL_FIELDS.has(key))));
    if (kept.length === config.models.length) continue;
    const { models: _models, ...rest } = config;
    providers = { ...providers, [providerId]: kept.length > 0 ? { ...rest, models: kept } : rest };
  }
  return providers === existing.providers ? existing : { ...existing, providers };
}

export function mergeModelsConfig(existing, declared = openaiModels) {
  if (!object(existing)) throw new TypeError('Expected models configuration object');
  return mergeDeclared(retireModels(existing), declared);
}

// Own only declared fields. Models arrays merge by ID rather than replacing
// user models; ordinary arrays (modalities and pricing tiers) are owned leaves.
function mergeDeclared(existing, declared) {
  if (!object(existing)) throw new TypeError('Expected models configuration object');
  const result = { ...existing };
  for (const [key, value] of Object.entries(declared)) {
    if (key === 'models' && Array.isArray(value)) {
      const previous = Object.hasOwn(existing, key) ? existing[key] : [];
      validModels(previous);
      result[key] = previous.map((model) => ({ ...model }));
      for (const model of value) {
        const index = result[key].findIndex((entry) => entry.id === model.id);
        if (index < 0) result[key].push(structuredClone(model));
        else result[key][index] = mergeDeclared(result[key][index], model);
      }
    } else if (object(value)) {
      const previous = Object.hasOwn(existing, key) ? existing[key] : {};
      result[key] = mergeDeclared(previous, value);
    } else {
      result[key] = structuredClone(value);
    }
  }
  return result;
}

export async function inspectModelsConfig(ctx) {
  const target = join(ctx.agentDir, 'models.json');
  try {
    const bytes = await ctx.readBytes(target);
    if (bytes?.notFound === true) return { outcome: 'drift', missing: true, merged: mergeModelsConfig({}) };
    if (!Buffer.isBuffer(bytes)) return { outcome: 'failed', code: 'EINVAL' };
    let existing;
    let merged;
    try {
      existing = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
      merged = mergeModelsConfig(existing);
    } catch {
      return { outcome: 'failed', unreadable: true };
    }
    return { outcome: isDeepStrictEqual(existing, merged) ? 'ok' : 'drift', bytes, merged };
  } catch (error) {
    return { outcome: 'failed', code: error?.code };
  }
}

export async function installModelsConfig(ctx, backupStamp) {
  const inspected = await inspectModelsConfig(ctx);
  if (inspected.outcome !== 'drift') return inspected;
  const target = join(ctx.agentDir, 'models.json');
  try {
    const facts = await ctx.stat(target);
    if (!facts?.notFound && !facts?.isFile) {
      return { outcome: 'failed', code: facts?.isDirectory ? 'EISDIR' : 'EINVAL' };
    }
    const result = await writeOwnedFile(ctx, {
      target: await ctx.realpath(target),
      relativePath: 'models.json',
      bytes: Buffer.from(`${JSON.stringify(inspected.merged, null, 2)}\n`),
      mode: facts?.notFound ? undefined : facts.mode,
      backupBytes: inspected.bytes,
      backupStamp: inspected.bytes ? backupStamp() : undefined,
    });
    if (result.type === 'backup-failed') return { outcome: 'failed', backup: true };
    if (result.type === 'write-failed') return { outcome: 'failed', code: result.error?.code };
    if (result.type === 'interrupted') return null;
    return { outcome: 'changed' };
  } catch (error) {
    return { outcome: 'failed', code: error?.code };
  }
}
