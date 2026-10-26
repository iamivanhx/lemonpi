import { sanitizeDiagnostic } from '../sanitize.js';
import { catalog } from './catalog.js';
import { identifySource } from './identity.js';
import { readSettings } from './settings.js';

export const packagesPart = Object.freeze({
  name: 'Packages',
  commands: Object.freeze(['install', 'update', 'status', 'doctor']),
  async run(ctx) {
    if (ctx.command === 'install' || ctx.command === 'update') return [];

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
          name: `${id} (${source})`,
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
      const identity = identifySource(source)?.identity;
      const installed = identity !== undefined && declaredIdentities.has(identity);
      return {
        name: `${id} (${source})`,
        kind: 'inventory',
        outcome: installed ? 'ok' : 'drift',
        ...(!installed ? { reason: 'not installed — `install` adds it' } : {}),
      };
    });
  },
});
