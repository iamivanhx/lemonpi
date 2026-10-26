const PLATFORM_REFUSAL = 'Windows is not supported; lemonpi runs on macOS and Debian/Linux';
const REQUIRED_NODE_VERSION = '22.19.0';
const REQUIRED_PI_VERSION = '1.4.0';
const SEMVER_PATTERN = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z.-]+))?$/;
const PI_VERSION_PATTERN = /^(?:\S+\s+)?(v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z.-]+)?)$/;

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

  const result = await host.runner('pi', ['--version']);
  if (result.notFound) {
    return failedPi('Pi not found on PATH; lemonpi configures an existing Pi and never installs it');
  }

  if (result.code !== 0) {
    const output = result.stderr?.trim() || result.stdout?.trim();
    const detail = output ? `: ${output}` : '';
    return failedPi(`pi --version failed with exit ${result.code}${detail}`);
  }

  const rawVersion = result.stdout?.trim() ?? '';
  const piVersion = parseVersion(rawVersion, PI_VERSION_PATTERN);
  if (!piVersion) {
    const foundVersion = rawVersion || 'no version output';
    return failedPi(`Pi version output is unparseable: ${foundVersion}`);
  }

  const requiredPiVersion = parseVersion(REQUIRED_PI_VERSION);
  if (compareVersions(piVersion, requiredPiVersion) < 0) {
    return failedPi(`Pi ${piVersion.version} is too old; lemonpi requires Pi ${REQUIRED_PI_VERSION} or newer`, piVersion.version);
  }

  return { ok: true, type: 'pi', pi: { ok: true, version: piVersion.version } };
}
