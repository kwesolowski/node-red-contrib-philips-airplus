const { describeFetchCause } = require('../lib/fetch-error');

describe('describeFetchCause', () => {
  test('lists each address tried by a multi-address connect', () => {
    const cause = {
      code: 'ETIMEDOUT',
      errors: [
        { code: 'ETIMEDOUT', address: '162.159.142.13', port: 443 },
        { code: 'ETIMEDOUT', address: '172.66.2.9', port: 443 },
      ],
    };
    expect(describeFetchCause(cause)).toBe(
      'ETIMEDOUT [ETIMEDOUT 162.159.142.13:443, ETIMEDOUT 172.66.2.9:443]'
    );
  });

  test('names the single address that failed', () => {
    const cause = { code: 'ECONNREFUSED', address: '10.0.0.1', port: 443 };
    expect(describeFetchCause(cause)).toBe('ECONNREFUSED 10.0.0.1:443');
  });

  test('names the host of a failed DNS lookup', () => {
    const cause = { code: 'ENOTFOUND', hostname: 'www.api.air.philips.com' };
    expect(describeFetchCause(cause)).toBe('ENOTFOUND www.api.air.philips.com');
  });

  test('does not throw on odd input', () => {
    expect(describeFetchCause('socket hang up')).toBe('socket hang up');
    expect(describeFetchCause({ code: 'X', errors: [null, { message: 'm' }] })).toBe(
      'X [null, m]'
    );
    expect(describeFetchCause({ code: 'X', address: '10.0.0.1' })).toBe('X 10.0.0.1');
    expect(describeFetchCause(Object.create(null))).toBe('unprintable cause');
    expect(describeFetchCause({ code: Symbol('s'), errors: [1] })).toBe('unprintable cause');
  });

  test('falls back to the code, then the message', () => {
    expect(describeFetchCause({ code: 'ENOTFOUND' })).toBe('ENOTFOUND');
    expect(describeFetchCause({ message: 'other side closed' })).toBe('other side closed');
  });
});
