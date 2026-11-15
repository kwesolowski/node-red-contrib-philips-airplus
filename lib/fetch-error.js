/**
 * Describe one network error: its code (or message), then the address or host it was for.
 * @param {*} e - Error-like value
 * @returns {string}
 */
function describeOne(e) {
  if (!e || typeof e !== 'object') return String(e);
  const code = e.code || e.message || String(e);
  if (e.address) return `${code} ${e.address}${e.port ? `:${e.port}` : ''}`;
  return e.hostname ? `${code} ${e.hostname}` : code;
}

/**
 * Describe the network cause of a failed fetch: the error code, then the address that failed.
 * A connect that tried several addresses (Node's autoSelectFamily) lists each attempt.
 * Called from a catch block, so it must not throw for any input.
 * @param {*} [cause] - `err.cause` of the fetch TypeError
 * @returns {string} e.g. "ETIMEDOUT [ETIMEDOUT 1.2.3.4:443, ETIMEDOUT 5.6.7.8:443]"
 */
function describeFetchCause(cause) {
  if (!cause) return '';
  if (cause && Array.isArray(cause.errors) && cause.errors.length > 0) {
    const code = cause.code || cause.message || 'AggregateError';
    return `${code} [${cause.errors.map(describeOne).join(', ')}]`;
  }
  return describeOne(cause);
}

module.exports = { describeFetchCause };
