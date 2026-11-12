import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { AccessibilityInfo, Animated, Keyboard } from 'react-native';
import { useAuthTransition } from './useAuthTransition';

let mockFocused = true;
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
let transition: ReturnType<typeof useAuthTransition>;
function Probe() {
  const value = useAuthTransition(1);
  React.useLayoutEffect(() => { transition = value; });
  return null;
}
let tree: renderer.ReactTestRenderer;
let complete: ((result: { finished: boolean }) => void) | undefined;
let removed: jest.Mock;

beforeEach(() => {
  mockFocused = true;
  complete = undefined;
  removed = jest.fn();
  jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: removed });
  jest.spyOn(Animated, 'timing').mockImplementation(() => ({
    start: callback => { complete = callback; },
    stop: jest.fn(), reset: jest.fn(),
  }));
});
afterEach(() => {
  if (tree) act(() => tree.unmount());
  jest.restoreAllMocks();
});

test('animates entry and waits for exit before navigating, blocking duplicate clicks', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  await act(async () => { tree = renderer.create(<Probe />); });
  expect(Animated.timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ duration: 460, toValue: 1 }));
  const navigate = jest.fn();
  act(() => { transition.switchScreen(navigate); transition.switchScreen(navigate); });
  expect(transition.switching).toBe(true);
  expect(navigate).not.toHaveBeenCalled();
  expect(Animated.timing).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ duration: 300, toValue: 0 }));
  act(() => complete?.({ finished: true }));
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(Keyboard.dismiss).toHaveBeenCalled();
});

test('honors reduced motion and navigates immediately without tweening', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  await act(async () => { tree = renderer.create(<Probe />); });
  const navigate = jest.fn();
  act(() => transition.switchScreen(navigate));
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(Animated.timing).not.toHaveBeenCalled();
});

test('entry waits for the motion preference without flashing a fully visible form', async () => {
  let resolveMotion!: (value: boolean) => void;
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => new Promise(resolve => { resolveMotion = resolve; }));
  act(() => { tree = renderer.create(<Probe />); });
  expect(transition.animatedStyle.opacity).toEqual(expect.objectContaining({ _value: 0 }));
  expect(Animated.timing).not.toHaveBeenCalled();
  await act(async () => { resolveMotion(false); });
  expect(Animated.timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ duration: 460, toValue: 1 }));
});

test('a failed motion-preference lookup reveals the form without animation', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockRejectedValue(new Error('Preference unavailable'));
  await act(async () => { tree = renderer.create(<Probe />); });
  expect(transition.animatedStyle.opacity).toEqual(expect.objectContaining({ _value: 1 }));
  expect(Animated.timing).not.toHaveBeenCalled();
  const navigate = jest.fn();
  act(() => transition.switchScreen(navigate));
  expect(navigate).toHaveBeenCalledTimes(1);
});

test('cancelled exits do not navigate and focus restoration unlocks the form', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  await act(async () => { tree = renderer.create(<Probe />); });
  const navigate = jest.fn();
  act(() => transition.switchScreen(navigate));
  act(() => complete?.({ finished: false }));
  expect(navigate).not.toHaveBeenCalled();
  mockFocused = false;
  act(() => tree.update(<Probe />));
  mockFocused = true;
  act(() => tree.update(<Probe />));
  expect(transition.switching).toBe(false);
  act(() => transition.switchScreen(navigate));
  act(() => complete?.({ finished: true }));
  expect(navigate).toHaveBeenCalledTimes(1);
});
