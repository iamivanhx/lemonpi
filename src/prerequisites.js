const PLATFORM_REFUSAL = 'Windows is not supported; lemonpi runs on macOS and Debian/Linux';
const REQUIRED_NODE_VERSION = '22.19.0';
const REQUIRED_PI_VERSION = '1.4.0';
const DIAGNOSTIC_WITHHELD = '[diagnostic withheld]';
const SEMVER_PATTERN = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const PI_VERSION_PATTERN = /^(?:\S+\s+)?(v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)$/;

function sanitizeDiagnostic(value, env = {}) {
  const secrets = Object.entries(env)
    .filter(([key, secret]) => /credential|token|password|secret|api.?key|auth/i.test(key) && typeof secret === 'string' && secret.length > 0)
    .map(([, secret]) => secret)
    .sort((left, right) => right.length - left.length);

  let diagnostic = String(value)
    .replace(/-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----[\s\S]*?(?:-----END \1-----|$)/gi, DIAGNOSTIC_WITHHELD);
  for (const secret of secrets) diagnostic = diagnostic.split(secret).join('[redacted]');
  diagnostic = diagnostic
    .replace(
      /(["']?(?:organization|org)(?:[_\s-]*id)["']?\s*[:=]\s*)(["'])(?:\\[\s\S]|(?!\2)[\s\S])*\s*$/gi,
      '$1[diagnostic withheld]',
    )
    .replace(
      /(["']?[A-Za-z0-9._-]*(?:credential|token|password|secret|api[\s_-]?key|auth(?:orization)?)[A-Za-z0-9._-]*["']?\s*[:=]\s*)(["'])(?:\\[\s\S]|(?!\2)[\s\S])*\s*$/gi,
      '$1[diagnostic withheld]',
    )
    .replace(
      /(["']?(?:organization|org)(?:[_\s-]*id)["']?\s*[:=]\s*)(?!\[diagnostic withheld\])(?:"[\s\S]*?"|'[\s\S]*?'|[^\s,;]+)/gi,
      '$1[redacted]',
    )
    .replace(
      /(["']?[A-Za-z0-9._-]*(?:credential|token|password|secret|api[\s_-]?key|auth(?:orization)?)[A-Za-z0-9._-]*["']?\s*[:=]\s*)(?!\[diagnostic withheld\])(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[^\s,;]+)/gi,
      '$1[redacted]',
    );

  return diagnostic.split(/\r?\n/).map((originalLine) => {
    if (/\bprivate key\b|-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/i.test(originalLine)) {
      return DIAGNOSTIC_WITHHELD;
    }

    let line = originalLine
      .replace(/(https?:\/\/)[^/@\s]+@/gi, '$1[redacted]@')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
      .replace(/\borg[-_][A-Za-z0-9_-]+/gi, '[redacted org ID]')
      .replace(/\bauthorization\s*:\s*[^\r\n]*/gi, 'Authorization: [redacted]')
      .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
      .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,}|sk[-_](?:live[-_])?[A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/g, '[redacted token]')
      .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted token]');

    if (/\b(?:credential|token|password|secret|api[\s_-]?key|auth(?:orization)?)\b(?!\s*[:=])\s+\S+/i.test(line)) {
      return DIAGNOSTIC_WITHHELD;
    }
    return line;
  }).join('\n');
}

function parseVersion(value, pattern = SEMVER_PATTERN) {
  const match = pattern.exec(String(value).trim());
  if (!match) return null;

  const versionText = match[0].replace(/^\S+\s+/, '').replace(/^v/, '');
  const versionMatch = SEMVER_PATTERN.exec(versionText);
  if (!versionMatch) return null;

  return {
    major: Number(versionMatch[1]),
    minor: Number(versionMatch[2]),
    patch: Number(versionMatch[3]),
    prerelease: versionMatch[4]?.split('.') ?? null,
    version: `${versionMatch[1]}.${versionMatch[2]}.${versionMatch[3]}${versionMatch[4] ? `-${versionMatch[4]}` : ''}${versionMatch[5] ? `+${versionMatch[5]}` : ''}`,
  };
}

function compareVersions(left, right) {
  for (const component of ['major', 'minor', 'patch']) {
    if (left[component] !== right[component]) return left[component] < right[component] ? -1 : 1;
  }

  if (left.prerelease === null && right.prerelease === null) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;

  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    if (leftIdentifier === rightIdentifier) continue;

    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) return Number(leftIdentifier) < Number(rightIdentifier) ? -1 : 1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftIdentifier < rightIdentifier ? -1 : 1;
  }

  return 0;
}

function refuse(message) {
  return { ok: false, type: 'refusal', message };
}

function failedPi(reason, version = null) {
  return { ok: false, type: 'pi', pi: { ok: false, version, reason } };
}

export async function checkPrerequisites(host) {
  if (host.platform !== 'darwin' && host.platform !== 'linux') {
    return refuse(PLATFORM_REFUSAL);
  }

  const foundNodeVersion = String(host.nodeVersion).trim();
  const nodeVersion = parseVersion(foundNodeVersion);
  const requiredNodeVersion = parseVersion(REQUIRED_NODE_VERSION);
  if (!nodeVersion || compareVersions(nodeVersion, requiredNodeVersion) < 0) {
    const printableVersion = foundNodeVersion.replace(/^v/, '') || 'unknown';
    return refuse(`Node ${printableVersion} is not supported; lemonpi requires Node ${REQUIRED_NODE_VERSION} or newer`);
  }

  const result = await host.runner('pi', ['--version'], { signal: host.signal });
  if (result.notFound) {
    return failedPi('Pi not found on PATH; lemonpi configures an existing Pi and never installs it; command: pi --version');
  }

  if (result.code !== 0) {
    const diagnostics = [
      ['stdout', result.stdout],
      ['stderr', result.stderr],
      ['error', result.error],
    ].filter(([, value]) => typeof value === 'string' && value.trim())
      .map(([label, value]) => `${label}: ${sanitizeDiagnostic(value.trim(), host.env)}`);
    const detail = diagnostics.length ? `: ${diagnostics.join('\n')}` : '';
    return failedPi(`pi --version failed with exit ${result.code}${detail}`);
  }

  const rawVersion = result.stdout?.trim() ?? '';
  const piVersion = parseVersion(rawVersion, PI_VERSION_PATTERN);
  if (!piVersion) {
    return failedPi('pi --version output is unparseable (raw output withheld)');
  }

  const requiredPiVersion = parseVersion(REQUIRED_PI_VERSION);
  if (compareVersions(piVersion, requiredPiVersion) < 0) {
    return failedPi(`Pi ${piVersion.version} is too old; lemonpi requires Pi ${REQUIRED_PI_VERSION} or newer`, piVersion.version);
  }

  return { ok: true, type: 'pi', pi: { ok: true, version: piVersion.version } };
}
