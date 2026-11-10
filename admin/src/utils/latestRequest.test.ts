import { expect, it } from 'vitest';
import { createLatestRequest } from './latestRequest';

it('rejects stale responses and aborts requests on replacement or unmount', () => {
  const requests = createLatestRequest();
  requests.cancel();
  const first = requests.begin();
  expect(first.isLatest()).toBe(true);
  const second = requests.begin();
  expect(first.signal.aborted).toBe(true);
  expect(first.isLatest()).toBe(false);
  expect(second.isLatest()).toBe(true);

  requests.cancel();
  requests.cancel();
  expect(second.signal.aborted).toBe(true);
  expect(second.isLatest()).toBe(false);

  const restarted = requests.begin();
  expect(restarted.signal.aborted).toBe(false);
  expect(restarted.isLatest()).toBe(true);
  expect(first.isLatest()).toBe(false);
  expect(second.isLatest()).toBe(false);
});
