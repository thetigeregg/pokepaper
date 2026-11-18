import assert from 'node:assert/strict';
import test from 'node:test';

import { composeLocalBackendOrigin, resolveLanHost } from './lan-host.mjs';

test('resolveLanHost prefers IOS_LAN_HOST when set', () => {
  assert.equal(resolveLanHost({ IOS_LAN_HOST: '192.168.1.42' }), '192.168.1.42');
});

test('resolveLanHost picks en0 private IPv4 before other interfaces', () => {
  const host = resolveLanHost(
    {},
    {
      networkInterfaces: () => ({
        lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
        en5: [{ family: 'IPv4', internal: false, address: '10.0.0.5' }],
        en0: [{ family: 'IPv4', internal: false, address: '192.168.1.50' }],
      }),
    }
  );

  assert.equal(host, '192.168.1.50');
});

test('resolveLanHost falls back to any private IPv4 address', () => {
  const host = resolveLanHost(
    {},
    {
      networkInterfaces: () => ({
        en7: [{ family: 'IPv4', internal: false, address: '10.20.30.40' }],
      }),
    }
  );

  assert.equal(host, '10.20.30.40');
});

test('resolveLanHost skips VM bridges, Docker, and VPN tunnels when falling back', () => {
  const host = resolveLanHost(
    {},
    {
      networkInterfaces: () => ({
        bridge100: [{ family: 'IPv4', internal: false, address: '192.168.64.1' }],
        utun4: [{ family: 'IPv4', internal: false, address: '10.20.30.40' }],
        vmnet8: [{ family: 'IPv4', internal: false, address: '172.16.0.1' }],
        en5: [{ family: 'IPv4', internal: false, address: '192.168.1.77' }],
      }),
    }
  );

  assert.equal(host, '192.168.1.77');
});

test('resolveLanHost returns null when only virtual interfaces have a private address', () => {
  const host = resolveLanHost(
    {},
    {
      networkInterfaces: () => ({
        bridge100: [{ family: 'IPv4', internal: false, address: '192.168.64.1' }],
      }),
    }
  );

  assert.equal(host, null);
});

test('resolveLanHost returns null when no suitable address exists', () => {
  const host = resolveLanHost(
    {},
    {
      networkInterfaces: () => ({
        lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
      }),
    }
  );

  assert.equal(host, null);
});

test('resolveLanHost ignores internal/non-IPv4 interfaces', () => {
  const host = resolveLanHost(
    {},
    {
      networkInterfaces: () => ({
        lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
        en0: [
          { family: 'IPv6', internal: false, address: 'fe80::1' },
          { family: 'IPv4', internal: false, address: '192.168.0.5' },
        ],
      }),
    }
  );

  assert.equal(host, '192.168.0.5');
});

test('composeLocalBackendOrigin builds http origin from host and port', () => {
  assert.equal(composeLocalBackendOrigin('192.168.1.50', 3000), 'http://192.168.1.50:3000');
  assert.equal(composeLocalBackendOrigin('', 3000), null);
  assert.equal(composeLocalBackendOrigin('192.168.1.50', 0), null);
  assert.equal(composeLocalBackendOrigin('192.168.1.50', 'not-a-port'), null);
});

test('composeLocalBackendOrigin brackets IPv6 hosts', () => {
  assert.equal(composeLocalBackendOrigin('fe80::1', 3000), 'http://[fe80::1]:3000');
  assert.equal(composeLocalBackendOrigin('[fe80::1]', 3000), 'http://[fe80::1]:3000');
});
