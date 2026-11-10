import React, { useEffect } from 'react';
import renderer, { act } from 'react-test-renderer';
import { AppState, Platform } from 'react-native';
import { useResendCooldown } from './useResendCooldown';

let hook!: ReturnType<typeof useResendCooldown>;
function Harness() {
  const value = useResendCooldown();
  useEffect(() => { hook = value; });
  return null;
}
let tree: renderer.ReactTestRenderer;
let resume: () => void;
let remove: jest.Mock;
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(100000);
  remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    resume = () => listener('active');
    return { remove };
  });
  act(() => { tree = renderer.create(<Harness />); });
});
afterEach(() => { act(() => tree.unmount()); jest.restoreAllMocks(); jest.useRealTimers(); });

test('late ticks derive ceil seconds from the deadline instead of counting callbacks', () => {
  act(() => hook.start(60));
  expect(hook.countdown).toBe(60);
  jest.setSystemTime(130100);
  act(() => jest.advanceTimersByTime(1000));
  expect(hook.countdown).toBe(29);
  act(() => tree.update(<Harness />));
  jest.setSystemTime(159999);
  expect(hook.isCoolingDown()).toBe(true);
  act(() => resume());
  expect(hook.countdown).toBe(1);
  jest.setSystemTime(160000);
  expect(hook.isCoolingDown()).toBe(false);
  act(() => resume());
  expect(hook.countdown).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
  expect(remove).toHaveBeenCalledTimes(1);
});

test('resume after suspension expires immediately and reset preserves caller phone policy', () => {
  act(() => hook.start(45));
  jest.setSystemTime(180000);
  act(() => resume());
  expect(hook.countdown).toBe(0);
  act(() => hook.start(30));
  expect(hook.countdown).toBe(30);
  act(() => hook.reset());
  expect(hook.countdown).toBe(0);
  expect(hook.isCoolingDown()).toBe(false);
});

test('web visibility refreshes without a timer tick and all listeners clean up on unmount', () => {
  const os = Platform.OS;
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const listeners = new Map<string, () => void>();
  const browserDocument = {
    addEventListener: jest.fn((name: string, listener: () => void) => listeners.set(name, listener)),
    removeEventListener: jest.fn((name: string) => listeners.delete(name)),
  };
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: browserDocument });
  try {
    act(() => hook.start(60));
    jest.setSystemTime(141200);
    act(() => listeners.get('visibilitychange')!());
    expect(hook.countdown).toBe(19);
    act(() => tree.unmount());
    expect(jest.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  } finally {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
    if (original) Object.defineProperty(globalThis, 'document', original);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
