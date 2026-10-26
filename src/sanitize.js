const DIAGNOSTIC_WITHHELD = '[diagnostic withheld]';

export function sanitizeDiagnostic(value, env = {}) {
  const secrets = Object.entries(env)
    .filter(([key, secret]) => /credential|token|password|secret|api.?key|auth/i.test(key) && typeof secret === 'string' && secret.length > 0)
    .map(([, secret]) => secret)
    .sort((left, right) => right.length - left.length);

  let diagnostic = String(value)
    .replace(/-----BEGIN ([A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?)-----[\s\S]*?(?:-----END \1-----|$)/gi, DIAGNOSTIC_WITHHELD);
  for (const secret of secrets) diagnostic = diagnostic.split(secret).join('[redacted]');
  diagnostic = diagnostic.replace(
    /(["']?(?:(?:organization|org)[_\s-]*id|[A-Za-z0-9._-]*(?:credential|token|password|secret|api[\s_-]?key|auth(?:orization)?)[A-Za-z0-9._-]*)["']?\s*[:=]\s*)(?:("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*')|[\s\S]*)/gi,
    // Only a complete quoted scalar has a reliable end. For unquoted, structured,
    // or truncated values, withhold the rest rather than guessing a delimiter.
    (_match, field, quotedValue) => `${field}${quotedValue === undefined ? DIAGNOSTIC_WITHHELD : '[redacted]'}`,
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
