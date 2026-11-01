import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
import { openaiModels } from './openai-models.js';
import { writeOwnedFile } from './writer.js';

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Own only declared fields. Models arrays merge by ID rather than replacing
// user models; ordinary arrays (modalities and pricing tiers) are owned leaves.
export function mergeModelsConfig(existing, declared = openaiModels) {
  if (!object(existing)) throw new TypeError('Expected models configuration object');
  const result = { ...existing };
  for (const [key, value] of Object.entries(declared)) {
    if (key === 'models' && Array.isArray(value)) {
      const previous = Object.hasOwn(existing, key) ? existing[key] : [];
      if (!Array.isArray(previous) || previous.some((model) => !object(model) || typeof model.id !== 'string')) {
        throw new TypeError('Expected model definitions');
      }
      const ids = previous.map((model) => model.id);
      if (new Set(ids).size !== ids.length) throw new TypeError('Duplicate model IDs');
      result[key] = previous.map((model) => ({ ...model }));
      for (const model of value) {
        const index = result[key].findIndex((entry) => entry.id === model.id);
        if (index < 0) result[key].push(structuredClone(model));
        else result[key][index] = mergeModelsConfig(result[key][index], model);
      }
    } else if (object(value)) {
      const previous = Object.hasOwn(existing, key) ? existing[key] : {};
      result[key] = mergeModelsConfig(previous, value);
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
