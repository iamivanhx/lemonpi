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

function commandFailureReason(subcommand, source, result, env) {
  const command = sanitizeDiagnostic(`pi ${subcommand} ${source} --no-approve`, env);
  const diagnostics = [
    ['stdout', result.stdout],
    ['stderr', result.stderr],
    ['error', result.error],
  ].filter(([, value]) => typeof value === 'string' && value.trim())
    .map(([label, value]) => `${label}: ${sanitizeDiagnostic(value.trim(), env)}`);
  return [command, ...diagnostics].join('\n');
}

function installFailureReason(source, result, env) {
  return commandFailureReason('install', source, result, env);
}

function settingsFailureItem(settings, env) {
  const path = sanitizeDiagnostic(settings.path, env);
  const error = sanitizeDiagnostic(settings.error, env);
  return {
    name: 'Pi settings',
    kind: 'action',
    outcome: 'failed',
    reason: `can't parse ${path}: ${error}`,
    required: true,
  };
}

function stopForUnreadableSettings(items, settings, notices, env) {
  return [...items, settingsFailureItem(settings, env), ...noticeItems(notices, env)];
}

async function updatePackage(ctx, item, source) {
  if (ctx.command !== 'update') return { items: [item] };
  if (ctx.dryRun) {
    return {
      items: [{
        ...item,
        outcome: 'changed',
        reason: item.outcome === 'changed' ? `${item.reason}; would update` : 'would update',
      }],
    };
  }
  if (ctx.signal.aborted) return { items: [item] };

  const result = await ctx.runner('pi', ['update', source, '--no-approve'], {
    cwd: ctx.tmpdir,
    signal: ctx.signal,
  });
  const settings = await readSettings(ctx);
  const updatedItem = commandFailed(result)
    ? {
      ...item,
      outcome: 'failed',
      reason: commandFailureReason('update', source, result, ctx.env),
    }
    : item;
  return {
    items: [updatedItem],
    ...(settings.ok ? {} : { settingsFailure: settings }),
  };
}

function commandFailed(result) {
  return result.notFound || result.error || result.code !== 0;
}

function migrationFailure(name, required, diagnostics = '', env) {
  return {
    name,
    kind: 'action',
    outcome: 'failed',
    reason: sanitizeDiagnostic([
      'replacement not installed; npm:pi-subagents kept',
      diagnostics,
    ].filter(Boolean).join('\n'), env),
    required,
  };
}

async function migrateReplaced(ctx, { id, source, required, declarations, replacedDeclarations }) {
  const name = itemName(id, source, ctx.env);
  const needsInstall = declarations.length !== 1 || declarations[0].pinned;
  let installResult;
  if (needsInstall) {
    if (ctx.signal.aborted) return { item: null };
    installResult = await ctx.runner('pi', ['install', source, '--no-approve'], {
      cwd: ctx.tmpdir,
      signal: ctx.signal,
    });
  }

  const afterInstall = await readSettings(ctx);
  if (!afterInstall.ok) {
    const item = installResult && commandFailed(installResult)
      ? migrationFailure(name, required, installFailureReason(source, installResult, ctx.env), ctx.env)
      : null;
    return { item, settingsFailure: afterInstall };
  }
  if (installResult && commandFailed(installResult)) {
    return {
      item: migrationFailure(name, required, installFailureReason(source, installResult, ctx.env), ctx.env),
    };
  }
  if (ctx.signal.aborted && needsInstall) {
    return {
      item: {
        name,
        kind: 'action',
        outcome: 'changed',
        reason: sanitizeDiagnostic(
          'replacement installed; migration interrupted before removing npm:pi-subagents',
          ctx.env,
        ),
        required,
      },
    };
  }

  const installedIdentity = identifySource(source)?.identity;
  const installedDeclarations = afterInstall.declarations.filter(({ identity }) => identity === installedIdentity);
  const verified = installedDeclarations.length === 1 && !installedDeclarations[0].pinned;
  if (!verified) {
    const installDiagnostics = installResult ? installFailureReason(source, installResult, ctx.env) : '';
    return { item: migrationFailure(name, required, installDiagnostics, ctx.env) };
  }

  let afterRemove;
  let lastRemoval;
  for (const declaration of replacedDeclarations) {
    if (ctx.signal.aborted) {
      return {
        item: {
          name,
          kind: 'action',
          outcome: 'changed',
          reason: sanitizeDiagnostic(
            'replacement verified; migration interrupted before removing npm:pi-subagents',
            ctx.env,
          ),
          required,
        },
      };
    }
    const removeSource = declaration.source;
    const result = await ctx.runner('pi', ['remove', removeSource, '--no-approve'], {
      cwd: ctx.tmpdir,
      signal: ctx.signal,
    });
    lastRemoval = { source: removeSource, result };
    afterRemove = await readSettings(ctx);
    if (!afterRemove.ok) {
      const item = commandFailed(result) ? {
        name,
        kind: 'action',
        outcome: 'failed',
        reason: commandFailureReason('remove', removeSource, result, ctx.env),
        required,
      } : null;
      return { item, settingsFailure: afterRemove };
    }
    if (commandFailed(result)) {
      return {
        item: {
          name,
          kind: 'action',
          outcome: 'failed',
          reason: commandFailureReason('remove', removeSource, result, ctx.env),
          required,
        },
      };
    }
    const replacementDeclarations = afterRemove.declarations.filter(({ identity }) => (
      identity === installedIdentity
    ));
    if (replacementDeclarations.length !== 1 || replacementDeclarations[0].pinned) {
      return {
        item: {
          name,
          kind: 'action',
          outcome: 'failed',
          reason: `${commandFailureReason('remove', removeSource, result, ctx.env)}\nreplacement declaration not verified after pi remove`,
          required,
        },
      };
    }
  }

  const replacedIdentities = new Set(replacedDeclarations.map(({ identity }) => identity));
  const replacedStillDeclared = afterRemove?.declarations.some(({ identity }) => (
    replacedIdentities.has(identity)
  ));
  if (replacedStillDeclared) {
    return {
      item: {
        name,
        kind: 'action',
        outcome: 'failed',
        reason: `${commandFailureReason('remove', lastRemoval.source, lastRemoval.result, ctx.env)}\nreplaced package still declared after pi remove`,
        required,
      },
    };
  }

  return {
    item: {
      name,
      kind: 'action',
      outcome: 'changed',
      reason: sanitizeDiagnostic(`migrated npm:pi-subagents → ${source}`, ctx.env),
      required,
    },
  };
}

async function installMissing(ctx) {
  const settings = await readSettings(ctx);
  if (!settings.ok) {
    const projectOnly = await classifySettings(ctx, []);
    return [settingsFailureItem(settings, ctx.env), ...noticeItems(projectOnly.notices, ctx.env)];
  }

  const classification = await classifySettings(ctx, settings.declarations);
  const { packages: classifiedPackages } = classification;
  const items = [];
  for (const { id, source, required, state, declarations, replacedDeclarations } of classifiedPackages) {
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

    if (state === 'migration-pending') {
      if (ctx.dryRun) {
        const update = await updatePackage(ctx, {
          name,
          kind: 'action',
          outcome: 'changed',
          reason: sanitizeDiagnostic(`would migrate npm:pi-subagents → ${source}`, ctx.env),
          required,
        }, source);
        items.push(...update.items);
      } else {
        const migration = await migrateReplaced(ctx, {
          id,
          source,
          required,
          declarations,
          replacedDeclarations,
        });
        if (migration.item?.outcome === 'changed' && !migration.settingsFailure) {
          const update = await updatePackage(ctx, migration.item, source);
          items.push(...update.items);
          if (update.settingsFailure) {
            return stopForUnreadableSettings(items, update.settingsFailure, classification.notices, ctx.env);
          }
        } else if (migration.item) {
          items.push(migration.item);
        }
        if (migration.settingsFailure) {
          return stopForUnreadableSettings(
            items,
            migration.settingsFailure,
            classification.notices,
            ctx.env,
          );
        }
      }
      continue;
    }

    const identity = identifySource(source)?.identity;
    const pinned = state === 'pinned';
    if (state === 'ok') {
      const update = await updatePackage(ctx, { name, kind: 'action', outcome: 'ok', required }, source);
      items.push(...update.items);
      if (update.settingsFailure) {
        return stopForUnreadableSettings(items, update.settingsFailure, classification.notices, ctx.env);
      }
      continue;
    }

    if (ctx.dryRun) {
      const update = await updatePackage(ctx, {
        name,
        kind: 'action',
        outcome: 'changed',
        reason: pinned
          ? sanitizeDiagnostic(`would unpin ${declarations[0].pin} → ${source}`, ctx.env)
          : 'would install',
        required,
      }, source);
      items.push(...update.items);
      continue;
    }

    const result = await ctx.runner('pi', ['install', source, '--no-approve'], {
      cwd: ctx.tmpdir,
      signal: ctx.signal,
    });
    const afterInstall = await readSettings(ctx);
    if (!afterInstall.ok) {
      if (commandFailed(result)) {
        items.push({
          name,
          kind: 'action',
          outcome: 'failed',
          reason: installFailureReason(source, result, ctx.env),
          required,
        });
      }
      return stopForUnreadableSettings(items, afterInstall, classification.notices, ctx.env);
    }
    const afterDeclarations = afterInstall.declarations.filter(({ identity: declaredIdentity }) => (
      declaredIdentity === identity
    ));
    const nowDeclared = pinned
      ? afterDeclarations.length === 1 && !afterDeclarations[0].pinned
      : afterDeclarations.length > 0;
    if (commandFailed(result)) {
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
          ? `still pinned after pi install\n${installFailureReason(source, result, ctx.env)}`
          : installFailureReason(source, result, ctx.env),
        required,
      });
      continue;
    }

    const update = await updatePackage(ctx, {
      name,
      kind: 'action',
      outcome: 'changed',
      reason: pinned
        ? sanitizeDiagnostic(`unpinned ${declarations[0].pin} → ${source}`, ctx.env)
        : 'installed',
      required,
    }, source);
    items.push(...update.items);
    if (update.settingsFailure) {
      return stopForUnreadableSettings(items, update.settingsFailure, classification.notices, ctx.env);
    }
  }
  return [...items, ...noticeItems(classification.notices, ctx.env)];
}

export const packagesPart = Object.freeze({
  name: 'Packages',
  commands: Object.freeze(['install', 'update', 'status', 'doctor']),
  async run(ctx) {
    if (ctx.command === 'install') return installMissing(ctx);
    if (ctx.command === 'update') return installMissing(ctx);

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
    const packageItems = classification.packages.map(({ id, source, state, declarations, replaces }) => {
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
      if (state === 'migration-pending') {
        return {
          name,
          kind: 'inventory',
          outcome: 'drift',
          reason: sanitizeDiagnostic(
            `${replaces[0]} still declared — ` + '`install` migrates it',
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
