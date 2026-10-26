import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sanitizeDiagnostic } from '../sanitize.js';
import { ownedConfig } from './manifest.js';

function item(descriptor, outcome, reason, env) {
  return {
    name: descriptor.name,
    kind: 'inventory',
    outcome,
    ...(reason === undefined ? {} : { reason: sanitizeDiagnostic(reason, env) }),
  };
}

function missing(descriptor, env) {
  return item(descriptor, 'drift', 'missing — `install` adds it', env);
}

function differs(descriptor, env) {
  return item(descriptor, 'drift', 'differs from shipped — `install` restores it', env);
}

function unknownSettings(descriptor, env) {
  return item(descriptor, 'unknown', 'Pi settings unreadable', env);
}

function failedFile(descriptor, code, env) {
  const safeCode = typeof code === 'string' ? code : 'UNKNOWN';
  return item(descriptor, 'failed', `${descriptor.path}: ${safeCode}`, env);
}

async function inspectDefaultModel(ctx, descriptor) {
  let contents;
  try {
    contents = await ctx.readFile(join(ctx.agentDir, 'settings.json'));
  } catch {
    return unknownSettings(descriptor, ctx.env);
  }
  if (contents?.notFound === true) return missing(descriptor, ctx.env);
  if (typeof contents !== 'string') return unknownSettings(descriptor, ctx.env);

  let settings;
  try {
    settings = JSON.parse(contents.replace(/^\uFEFF/, ''));
  } catch {
    return unknownSettings(descriptor, ctx.env);
  }
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
    return unknownSettings(descriptor, ctx.env);
  }
  if (settings.packages !== undefined && !Array.isArray(settings.packages)) {
    return unknownSettings(descriptor, ctx.env);
  }
  if (!Object.hasOwn(settings, 'defaultProvider') || !Object.hasOwn(settings, 'defaultModel')) {
    return missing(descriptor, ctx.env);
  }
  if (settings.defaultProvider === descriptor.defaultProvider
      && settings.defaultModel === descriptor.defaultModel) {
    return item(descriptor, 'ok', undefined, ctx.env);
  }
  return differs(descriptor, ctx.env);
}

async function inspectShippedFile(ctx, descriptor) {
  const target = join(ctx.agentDir, descriptor.path);
  let facts;
  try {
    facts = await ctx.stat(target);
  } catch (error) {
    return failedFile(descriptor, error?.code ?? 'UNKNOWN', ctx.env);
  }
  if (facts?.notFound) return missing(descriptor, ctx.env);
  if (!facts?.isFile) {
    return failedFile(descriptor, facts?.isDirectory ? 'EISDIR' : 'EINVAL', ctx.env);
  }

  let targetBytes;
  try {
    targetBytes = await ctx.readBytes(target);
  } catch (error) {
    return failedFile(descriptor, error?.code ?? 'UNKNOWN', ctx.env);
  }
  if (targetBytes?.notFound) return missing(descriptor, ctx.env);
  const shippedBytes = await readFile(descriptor.source);
  if (Buffer.isBuffer(targetBytes) && targetBytes.equals(shippedBytes)) {
    return item(descriptor, 'ok', undefined, ctx.env);
  }
  return differs(descriptor, ctx.env);
}

export const ownedConfigPart = Object.freeze({
  name: 'Owned config',
  commands: Object.freeze(['status', 'doctor']),
  async run(ctx) {
    const items = [];
    for (const descriptor of ownedConfig) {
      items.push(descriptor.kind === 'default-model'
        ? await inspectDefaultModel(ctx, descriptor)
        : await inspectShippedFile(ctx, descriptor));
    }
    return items;
  },
});
