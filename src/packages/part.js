import { sanitizeDiagnostic } from '../sanitize.js';
import { catalog } from './catalog.js';
import { identifySource } from './identity.js';
import { readSettings } from './settings.js';

function itemName(id, source, env) {
  return sanitizeDiagnostic(`${id} (${source})`, env);
}

function installFailureReason(source, result, env) {
  const command = sanitizeDiagnostic(`pi install ${source} --no-approve`, env);
  const diagnostics = [
    ['stdout', result.stdout],
    ['stderr', result.stderr],
    ['error', result.error],
  ].filter(([, value]) => typeof value === 'string' && value.trim())
    .map(([label, value]) => `${label}: ${sanitizeDiagnostic(value.trim(), env)}`);
  return [command, ...diagnostics].join('\n');
}

async function installMissing(ctx) {
  const settings = await readSettings(ctx);
  if (!settings.ok) {
    const path = sanitizeDiagnostic(settings.path, ctx.env);
    const error = sanitizeDiagnostic(settings.error, ctx.env);
    return [{
      name: 'Pi settings',
      kind: 'action',
      outcome: 'failed',
      reason: `can't parse ${path}: ${error}`,
      required: true,
    }];
  }

  const declaredIdentities = new Set(
    settings.declarations.map(({ identity }) => identity).filter(Boolean),
  );
  const items = [];
  for (const entry of catalog) {
    if (ctx.signal.aborted) break;
    const { id, source, required } = entry;
    const name = itemName(id, source, ctx.env);
    if (ctx.flags.skip.includes(id)) {
      items.push({
        name,
        kind: 'action',
        outcome: 'skipped',
        reason: 'held back by --skip',
        required,
      });
      continue;
    }

    const identity = identifySource(source)?.identity;
    if (declaredIdentities.has(identity)) {
      items.push({ name, kind: 'action', outcome: 'ok', required });
      continue;
    }

    if (ctx.dryRun) {
      items.push({ name, kind: 'action', outcome: 'changed', reason: 'would install', required });
      continue;
    }

    const result = await ctx.runner('pi', ['install', source, '--no-approve'], {
      cwd: ctx.tmpdir,
      signal: ctx.signal,
    });
    const afterInstall = await readSettings(ctx);
    const nowDeclared = afterInstall.ok
      && afterInstall.declarations.some(({ identity: declaredIdentity }) => declaredIdentity === identity);
    if (result.notFound || result.error || result.code !== 0 || !nowDeclared) {
      items.push({
        name,
        kind: 'action',
        outcome: 'failed',
        reason: installFailureReason(source, result, ctx.env),
        required,
      });
      continue;
    }

    declaredIdentities.add(identity);
    items.push({
      name,
      kind: 'action',
      outcome: 'changed',
      reason: 'installed',
      required,
    });
  }
  return items;
}

export const packagesPart = Object.freeze({
  name: 'Packages',
  commands: Object.freeze(['install', 'update', 'status', 'doctor']),
  async run(ctx) {
    if (ctx.command === 'install') return installMissing(ctx);
    if (ctx.command === 'update') return [];

    const settings = await readSettings(ctx);
    if (!settings.ok) {
      const path = sanitizeDiagnostic(settings.path, ctx.env);
      const error = sanitizeDiagnostic(settings.error, ctx.env);
      return [
        {
          name: 'Pi settings',
          kind: 'inventory',
          outcome: 'failed',
          reason: `can't parse ${path}: ${error}`,
        },
        ...catalog.map(({ id, source }) => ({
          name: itemName(id, source, ctx.env),
          kind: 'inventory',
          outcome: 'unknown',
          reason: 'settings unreadable',
        })),
      ];
    }

    const declaredIdentities = new Set(
      settings.declarations.map(({ identity }) => identity).filter(Boolean),
    );
    return catalog.map(({ id, source }) => {
      const name = itemName(id, source, ctx.env);
      if (ctx.flags.skip.includes(id)) {
        return {
          name,
          kind: 'inventory',
          outcome: 'skipped',
          reason: 'held back by --skip',
        };
      }
      const identity = identifySource(source)?.identity;
      const installed = identity !== undefined && declaredIdentities.has(identity);
      return {
        name,
        kind: 'inventory',
        outcome: installed ? 'ok' : 'drift',
        ...(!installed ? { reason: 'not installed — `install` adds it' } : {}),
      };
    });
  },
});
