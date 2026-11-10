import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADVISORY_IDS,
  NOTIFICATION_MARKER,
  buildNotification,
  compareVersions,
  evaluateUpstreamState,
} from './check-image-size-upstream.mjs';

function advisory(id, patchedVersion) {
  return {
    ghsa_id: id,
    updated_at: '2026-09-01T00:00:00Z',
    vulnerabilities: [
      {
        package: { ecosystem: 'npm', name: 'image-size' },
        vulnerable_version_range: '<= 2.0.2',
        first_patched_version: patchedVersion
          ? { identifier: patchedVersion }
          : null,
      },
    ],
  };
}

test('compares semantic versions used by the npm registry', () => {
  assert.equal(compareVersions('2.0.2', '2.0.2'), 0);
  assert.equal(compareVersions('2.0.3', '2.0.2'), 1);
  assert.equal(compareVersions('1.12.0', '2.0.0'), -1);
});

test('keeps the issue blocked while either advisory has no patch', () => {
  const state = evaluateUpstreamState('2.0.2', [
    advisory(ADVISORY_IDS[0], null),
    advisory(ADVISORY_IDS[1], '2.0.3'),
  ]);

  assert.equal(state.fixAvailable, false);
});

test('waits until every patched version is available on npm', () => {
  const state = evaluateUpstreamState('2.0.3', [
    advisory(ADVISORY_IDS[0], '2.0.3'),
    advisory(ADVISORY_IDS[1], '2.0.4'),
  ]);

  assert.equal(state.fixAvailable, false);
});

test('reports a fix and builds a deduplicated notification when ready', () => {
  const state = evaluateUpstreamState('2.0.4', [
    advisory(ADVISORY_IDS[0], '2.0.3'),
    advisory(ADVISORY_IDS[1], '2.0.4'),
  ]);

  assert.equal(state.fixAvailable, true);
  const notification = buildNotification(state);
  assert.match(notification, new RegExp(NOTIFICATION_MARKER));
  assert.match(notification, /image-size/);
  assert.match(notification, /2\.0\.4/);
});

test('fails closed when advisory data no longer contains the expected package', () => {
  assert.throws(
    () =>
      evaluateUpstreamState('2.0.4', [
        { ...advisory(ADVISORY_IDS[0], '2.0.3'), vulnerabilities: [] },
        advisory(ADVISORY_IDS[1], '2.0.4'),
      ]),
    /no npm image-size vulnerability/,
  );
});
