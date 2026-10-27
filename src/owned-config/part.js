import { join } from 'node:path';
import { sanitizeDiagnostic } from '../sanitize.js';
import { readShippedContent } from './bundled-data.js';
import { ownedConfig } from './manifest.js';
import { writeOwnedFile } from './writer.js';

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
  const safeCode = typeof code === 'string' && /^(?:E[A-Z0-9_]+|ERR_[A-Z0-9_]+|UNKNOWN)$/.test(code)
    ? code
    : 'UNKNOWN';
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

function action(descriptor, outcome, reason, env, required) {
  return {
    name: descriptor.name,
    kind: 'action',
    outcome,
    ...(reason === undefined ? {} : { reason: sanitizeDiagnostic(reason, env) }),
    ...(required === undefined ? {} : { required }),
  };
}

function actionFailure(descriptor, code, env) {
  const safeCode = typeof code === 'string' && /^(?:E[A-Z0-9_]+|ERR_[A-Z0-9_]+|UNKNOWN)$/.test(code)
    ? code
    : 'UNKNOWN';
  return action(descriptor, 'failed', `${descriptor.path ?? 'settings.json'}: ${safeCode}`, env, true);
}

function unreadableSettings(descriptor, env) {
  return action(descriptor, 'failed', 'Pi settings unreadable; default model not set', env, true);
}

async function installDefaultModel(ctx, descriptor, backupStamp) {
  const target = join(ctx.agentDir, 'settings.json');
  let existingBytes;
  try {
    existingBytes = await ctx.readBytes(target);
  } catch (error) {
    return actionFailure(descriptor, error?.code, ctx.env);
  }

  let settings = {};
  if (existingBytes?.notFound !== true) {
    if (!Buffer.isBuffer(existingBytes)) return unreadableSettings(descriptor, ctx.env);
    try {
      settings = JSON.parse(existingBytes.toString('utf8').replace(/^\uFEFF/, ''));
    } catch {
      return unreadableSettings(descriptor, ctx.env);
    }
    if (settings === null || typeof settings !== 'object' || Array.isArray(settings)
        || (settings.packages !== undefined && !Array.isArray(settings.packages))) {
      return unreadableSettings(descriptor, ctx.env);
    }
  }

  if (settings.defaultProvider === descriptor.defaultProvider
      && settings.defaultModel === descriptor.defaultModel) {
    return action(descriptor, 'ok', undefined, ctx.env);
  }
  settings.defaultProvider = descriptor.defaultProvider;
  settings.defaultModel = descriptor.defaultModel;

  let mode;
  if (Buffer.isBuffer(existingBytes)) {
    let facts;
    try {
      facts = await ctx.stat(target);
    } catch (error) {
      return actionFailure(descriptor, error?.code, ctx.env);
    }
    if (facts?.notFound) return actionFailure(descriptor, 'ENOENT', ctx.env);
    if (!facts?.isFile) return actionFailure(descriptor, facts?.isDirectory ? 'EISDIR' : 'EINVAL', ctx.env);
    mode = facts.mode;
  }

  let realTarget;
  try {
    realTarget = await ctx.realpath(target);
  } catch (error) {
    return actionFailure(descriptor, error?.code, ctx.env);
  }
  const shouldBackup = ctx.settingsExistedAtCommandEntry === true && Buffer.isBuffer(existingBytes);
  const result = await writeOwnedFile(ctx, {
    target: realTarget,
    relativePath: 'settings.json',
    bytes: Buffer.from(`${JSON.stringify(settings, null, 2)}\n`),
    mode,
    backupBytes: shouldBackup ? existingBytes : undefined,
    backupStamp: shouldBackup ? backupStamp() : undefined,
  });
  if (result.type === 'backup-failed') {
    return action(descriptor, 'failed', 'backup failed; not changed', ctx.env, true);
  }
  if (result.type === 'write-failed') {
    return actionFailure(descriptor, result.error?.code, ctx.env);
  }
  return action(descriptor, 'changed', 'set to claude-code/claude-opus-5-5', ctx.env);
}

async function installShippedFile(ctx, descriptor, backupStamp) {
  const target = join(ctx.agentDir, descriptor.path);
  const shippedBytes = await readShippedContent(descriptor);
  let facts;
  try {
    facts = await ctx.stat(target);
  } catch (error) {
    return actionFailure(descriptor, error?.code, ctx.env);
  }
  if (!facts?.notFound && !facts?.isFile) {
    return actionFailure(descriptor, facts?.isDirectory ? 'EISDIR' : 'EINVAL', ctx.env);
  }

  let existingBytes;
  if (!facts?.notFound) {
    try {
      existingBytes = await ctx.readBytes(target);
    } catch (error) {
      return actionFailure(descriptor, error?.code, ctx.env);
    }
    if (existingBytes?.notFound === true) {
      facts = { notFound: true };
    } else if (!Buffer.isBuffer(existingBytes)) {
      return actionFailure(descriptor, 'EINVAL', ctx.env);
    } else if (existingBytes.equals(shippedBytes)) {
      return action(descriptor, 'ok', undefined, ctx.env);
    }
  }

  const existing = facts?.notFound !== true;
  let realTarget;
  try {
    realTarget = await ctx.realpath(target);
  } catch (error) {
    return actionFailure(descriptor, error?.code, ctx.env);
  }
  const result = await writeOwnedFile(ctx, {
    target: realTarget,
    relativePath: descriptor.path,
    bytes: shippedBytes,
    mode: existing ? facts.mode : undefined,
    backupBytes: existing ? existingBytes : undefined,
    backupStamp: existing ? backupStamp() : undefined,
  });
  if (result.type === 'backup-failed') {
    return action(descriptor, 'failed', 'backup failed; not changed', ctx.env, true);
  }
  if (result.type === 'write-failed') {
    return actionFailure(descriptor, result.error?.code, ctx.env);
  }
  return action(descriptor, 'changed', existing ? 'restored shipped version' : 'added', ctx.env);
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
  const shippedBytes = await readShippedContent(descriptor);
  if (Buffer.isBuffer(targetBytes) && targetBytes.equals(shippedBytes)) {
    return item(descriptor, 'ok', undefined, ctx.env);
  }
  return differs(descriptor, ctx.env);
}

export const ownedConfigPart = Object.freeze({
  name: 'Owned config',
  commands: Object.freeze(['install', 'update', 'status', 'doctor']),
  async run(ctx) {
    const items = [];
    if (ctx.command === 'install' || ctx.command === 'update') {
      let backupTimestamp;
      const backupStamp = () => {
        backupTimestamp ??= ctx.now().toISOString().replace(/:/g, '-');
        return backupTimestamp;
      };
      for (const descriptor of ownedConfig) {
        if (ctx.signal.aborted) break;
        items.push(descriptor.kind === 'default-model'
          ? await installDefaultModel(ctx, descriptor, backupStamp)
          : await installShippedFile(ctx, descriptor, backupStamp));
      }
      return items;
    }
    for (const descriptor of ownedConfig) {
      items.push(descriptor.kind === 'default-model'
        ? await inspectDefaultModel(ctx, descriptor)
        : await inspectShippedFile(ctx, descriptor));
    }
    return items;
  },
});
