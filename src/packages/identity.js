const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const NPM_SPEC = /^npm:((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)(?:@([^/\r\n]+))?$/i;
const SCP_GIT = /^git@([^/:?#\s]+):(.+)$/i;
const GIT_SHORTHAND = /^([^/:?#\s]+)\/(.+)$/;

function parseGitSource(source) {
  let host;
  let path;

  if (/^https:\/\//i.test(source) || /^ssh:\/\/git@/i.test(source)) {
    let url;
    try {
      url = new URL(source);
    } catch {
      return null;
    }
    if (url.search || url.hash || !url.hostname) return null;
    if (url.protocol === 'ssh:' && url.username !== 'git') return null;
    host = url.host.toLowerCase();
    path = url.pathname.replace(/^\/+/, '');
  } else {
    if (!source.startsWith('git:')) return null;
    const value = source.slice('git:'.length);
    const scp = SCP_GIT.exec(value);
    if (scp) {
      [, host, path] = scp;
      host = host.toLowerCase();
    } else {
      const shorthand = GIT_SHORTHAND.exec(value);
      if (!shorthand) return null;
      [, host, path] = shorthand;
      host = host.toLowerCase();
    }
  }

  const refSeparator = path.indexOf('@');
  let ref = null;
  if (refSeparator !== -1) {
    ref = path.slice(refSeparator + 1);
    if (!ref) return null;
    path = path.slice(0, refSeparator);
  }
  path = path.replace(/\.git$/i, '');

  const pathSegments = path.split('/');
  if (pathSegments.length < 2 || pathSegments.some((segment) => !segment || segment === '.' || segment === '..')) {
    return null;
  }
  if (/[?#\s]/.test(path) || /[?#\s]/.test(host)) return null;

  return {
    identity: `git:${host}/${path}`,
    pinned: ref !== null,
    type: 'git',
  };
}

export function identifySource(source) {
  if (typeof source !== 'string' || source.length === 0) return null;

  if (source.startsWith('npm:')) {
    const match = NPM_SPEC.exec(source);
    if (!match || !NPM_NAME.test(match[1]) || (match[2] !== undefined && !match[2].trim())) return null;
    return {
      identity: `npm:${match[1]}`,
      pinned: match[2] !== undefined,
      type: 'npm',
    };
  }

  return parseGitSource(source);
}
