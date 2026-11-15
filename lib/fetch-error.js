/**
 * Describe the network cause of a failed fetch: the error code, then the address that failed.
 * A connect that tried several addresses (Node's autoSelectFamily) lists each attempt.
 * @param {object} [cause] - `err.cause` of the fetch TypeError
 * @returns {string} e.g. "ETIMEDOUT [1.2.3.4:443 ETIMEDOUT, 5.6.7.8:443 ETIMEDOUT]"
 */
function describeFetchCause(cause) {
  if (!cause) return '';
  const code = cause.code || cause.message;
  if (Array.isArray(cause.errors) && cause.errors.length > 0) {
    const attempts = cause.errors.map(e => `${e.address}:${e.port} ${e.code || e.message}`);
    return `${code} [${attempts.join(', ')}]`;
  }
  if (cause.address) return `${code} ${cause.address}:${cause.port}`;
  return cause.hostname ? `${code} ${cause.hostname}` : code;
}

module.exports = { describeFetchCause };
