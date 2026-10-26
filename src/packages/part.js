import { join } from 'node:path';
import { sanitizeDiagnostic } from '../sanitize.js';
import { catalog } from './catalog.js';
import { classifyPackages } from './classify.js';
import { identifySource } from './identity.js';
import { readSettings } from './settings.js';

function itemName(id, source, env) {
  return sanitizeDiagnostic(`${id} (${source})`, env);
}

async function classifySettings(ctx, globalDeclarations) {
  const projectSettings = await readSettings(ctx, join(ctx.cwd, '.pi', 'settings.json'));
  return classifyPackages(
    catalog,
    globalDeclarations,
    projectSettings.ok ? projectSettings.declarations : [],
    ctx.flags.skip,
  );
}

function noticeItems(notices, env) {
  return notices.map(({ name, reason }) => ({
    name: sanitizeDiagnostic(name, env),
    kind: 'notice',
    reason: sanitizeDiagnostic(reason, env),
  }));
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
    const projectOnly = await classifySettings(ctx, []);
    return [{
      name: 'Pi settings',
      kind: 'action',
      outcome: 'failed',
      reason: `can't parse ${path}: ${error}`,
      required: true,
    }, ...noticeItems(projectOnly.notices, ctx.env)];
  }

  const classification = await classifySettings(ctx, settings.declarations);
  const { packages: classifiedPackages } = classification;
  const items = [];
  for (const { id, source, required, state, declarations } of classifiedPackages) {
    if (ctx.signal.aborted) break;
    const name = itemName(id, source, ctx.env);
    if (state === 'skipped') {
      items.push({
        name,
        kind: 'action',
        outcome: 'skipped',
        reason: 'held back by --skip',
        required,
      });
      continue;
    }
    if (state === 'duplicated') {
      items.push({
        name,
        kind: 'action',
        outcome: 'failed',
        reason: `declared ${declarations.length} times in global settings; remove the extra declarations`,
        required,
      });
      continue;
    }

    const identity = identifySource(source)?.identity;
    const pinned = state === 'pinned';
    if (state === 'ok') {
      items.push({ name, kind: 'action', outcome: 'ok', required });
      continue;
    }

    if (ctx.dryRun) {
      items.push({
        name,
        kind: 'action',
        outcome: 'changed',
        reason: pinned
          ? sanitizeDiagnostic(`would unpin ${declarations[0].pin} → ${source}`, ctx.env)
          : 'would install',
        required,
      });
      continue;
    }

    const result = await ctx.runner('pi', ['install', source, '--no-approve'], {
      cwd: ctx.tmpdir,
      signal: ctx.signal,
    });
    const afterInstall = await readSettings(ctx);
    const afterDeclarations = afterInstall.ok
      ? afterInstall.declarations.filter(({ identity: declaredIdentity }) => declaredIdentity === identity)
      : [];
    const nowDeclared = pinned
      ? afterDeclarations.length === 1 && !afterDeclarations[0].pinned
      : afterDeclarations.length > 0;
    if (result.notFound || result.error || result.code !== 0) {
      items.push({
        name,
        kind: 'action',
        outcome: 'failed',
        reason: installFailureReason(source, result, ctx.env),
        required,
      });
      continue;
    }
    if (!nowDeclared) {
      items.push({
        name,
        kind: 'action',
        outcome: 'failed',
        reason: pinned && afterDeclarations.length === 1 && afterDeclarations[0].pinned
          ? 'still pinned after pi install'
          : installFailureReason(source, result, ctx.env),
        required,
      });
      continue;
    }

    items.push({
      name,
      kind: 'action',
      outcome: 'changed',
      reason: pinned
        ? sanitizeDiagnostic(`unpinned ${declarations[0].pin} → ${source}`, ctx.env)
        : 'installed',
      required,
    });
  }
  return [...items, ...noticeItems(classification.notices, ctx.env)];
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
      const projectOnly = await classifySettings(ctx, []);
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
        ...noticeItems(projectOnly.notices, ctx.env),
      ];
    }

    const classification = await classifySettings(ctx, settings.declarations);
    const packageItems = classification.packages.map(({ id, source, state, declarations }) => {
      const name = itemName(id, source, ctx.env);
      if (state === 'skipped') {
        return {
          name,
          kind: 'inventory',
          outcome: 'skipped',
          reason: 'held back by --skip',
        };
      }
      if (state === 'duplicated') {
        return {
          name,
          kind: 'inventory',
          outcome: 'drift',
          reason: `declared ${declarations.length} times — remove the extras`,
        };
      }
      if (state === 'pinned') {
        return {
          name,
          kind: 'inventory',
          outcome: 'drift',
          reason: sanitizeDiagnostic(
            `pinned to ${declarations[0].pin} — ` + '`install` unpins it',
            ctx.env,
          ),
        };
      }
      return {
        name,
        kind: 'inventory',
        outcome: state === 'ok' ? 'ok' : 'drift',
        ...(state !== 'ok' ? { reason: 'not installed — `install` adds it' } : {}),
      };
    });
    return [...packageItems, ...noticeItems(classification.notices, ctx.env)];
  },
});
