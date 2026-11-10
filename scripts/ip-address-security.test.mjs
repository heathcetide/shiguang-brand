import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';

// Resolve the actual SMS SDK proxy dependency, not an unrelated top-level copy.
let consumer = createRequire(new URL('../server/package.json', import.meta.url));
for (const name of ['@darabonba/typescript', 'socks-proxy-agent', 'socks']) {
  consumer = createRequire(consumer.resolve(name));
}
const addressPath = consumer.resolve('ip-address');

test('SMS proxy IP parser rejects hostile IPv6 zones without blocking the process', () => {
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const { Address6 } = require(process.argv[1]);
    for (const ending of ['\\n', '\\r', '\\u2028', '\\u2029']) {
      const input = '%'.repeat(256 * 1024) + ending;
      assert.equal(Address6.isValid(input), false);
      assert.throws(() => new Address6(input));
    }
  `, addressPath], { encoding: 'utf8', timeout: 3000, maxBuffer: 64 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('SMS proxy IPv4, IPv6, zone and URL parsing retain normal behavior', () => {
  const { Address4, Address6 } = consumer('ip-address');
  for (const ip of ['127.0.0.1', '192.168.1.1', '8.8.8.8']) assert.equal(Address4.isValid(ip), true);
  for (const ip of ['::1', '::ffff:127.0.0.1', '2001:db8::1', 'fe80::1%eth0']) assert.equal(Address6.isValid(ip), true);
  assert.equal(new Address6('fe80::1%eth0').zone, '%eth0');
  assert.equal(Address6.fromURL('http://[2001:db8::1]:8080/').address.correctForm(), '2001:db8::1');
  assert.equal(Address4.isValid('256.0.0.1'), false);
  assert.equal(Address6.isValid('not-an-address'), false);
});
