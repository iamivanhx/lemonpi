import { identifySource } from './identity.js';

function identityOf(source) {
  return identifySource(source)?.identity ?? null;
}

function declarationName(declaration) {
  return typeof declaration.source === 'string' && declaration.source.length > 0
    ? declaration.source
    : 'unparseable package declaration';
}

export function classifyPackages(catalog, globalDeclarations, projectDeclarations = [], skip = []) {
  const managedByIdentity = new Map(
    catalog.map((entry) => [identityOf(entry.source), entry]),
  );
  const replacedIdentities = new Set(catalog.flatMap(({ replaces = [] }) => (
    replaces.map(identityOf).filter(Boolean)
  )));
  const alternativesByIdentity = new Map();
  for (const entry of catalog) {
    for (const alternative of entry.alternatives ?? []) {
      const identity = identityOf(alternative);
      if (!identity) continue;
      const matches = alternativesByIdentity.get(identity) ?? [];
      matches.push(entry);
      alternativesByIdentity.set(identity, matches);
    }
  }

  const packages = catalog.map((entry) => {
    const declarations = globalDeclarations.filter(({ identity }) => (
      identity === identityOf(entry.source)
    ));
    const state = skip.includes(entry.id)
      ? 'skipped'
      : declarations.length > 1
        ? 'duplicated'
        : declarations.length === 1 && declarations[0].pinned
          ? 'pinned'
          : declarations.length === 1
            ? 'ok'
            : 'missing';
    return { ...entry, state, declarations };
  });

  const notices = [];
  for (const declaration of globalDeclarations) {
    if (managedByIdentity.has(declaration.identity) || replacedIdentities.has(declaration.identity)) {
      continue;
    }
    const alternatives = alternativesByIdentity.get(declaration.identity);
    if (alternatives) {
      for (const entry of alternatives) {
        notices.push({
          name: declarationName(declaration),
          reason: `${entry.id} declared from a different source type`,
        });
      }
      continue;
    }
    notices.push({ name: declarationName(declaration), reason: 'unmanaged package' });
  }

  for (const declaration of projectDeclarations) {
    const entry = managedByIdentity.get(declaration.identity);
    if (entry) {
      notices.push({
        name: declarationName(declaration),
        reason: `project-scope declaration of ${entry.id}`,
      });
    }
  }

  return { packages, notices };
}
