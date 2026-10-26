import { join } from 'node:path';
import { identifySource } from './identity.js';

function unreadable(path, error) {
  return { ok: false, path, error: String(error) };
}

export async function readSettings(ctx) {
  const path = join(ctx.agentDir, 'settings.json');
  let contents;
  try {
    contents = await ctx.readFile(path);
  } catch (error) {
    return unreadable(path, error?.message ?? 'settings file could not be read');
  }

  if (contents?.notFound === true) {
    return { ok: true, path, declarations: [] };
  }
  if (typeof contents !== 'string') {
    return unreadable(path, 'settings file could not be read');
  }

  let settings;
  try {
    settings = JSON.parse(contents);
  } catch (error) {
    return unreadable(path, error.message);
  }

  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
    return unreadable(path, 'settings must contain a JSON object');
  }
  if (settings.packages !== undefined && !Array.isArray(settings.packages)) {
    return unreadable(path, 'settings packages must be an array');
  }

  const declarations = (settings.packages ?? []).map((raw, index) => {
    const form = typeof raw === 'string' ? 'string' : 'object';
    const source = form === 'string' ? raw : raw?.source;
    const identified = identifySource(source);
    return {
      index,
      raw,
      source,
      identity: identified?.identity ?? null,
      pinned: identified?.pinned ?? false,
      pin: identified?.pin ?? null,
      form,
    };
  });

  return { ok: true, path, declarations };
}
