import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

const mockSetAlpha = jest.fn(() => ({ hex: () => '#7788994d' }));
jest.mock('@/heroui/helpers/external/hooks', () => ({ useThemeColor: () => [
  'color-mix(in oklab, green 90%, white 10%)',
  'color-mix(in oklab, white 96%, black 4%)',
  'red', 'pink',
] }));
jest.mock('@/heroui/helpers/external/utils', () => ({ colorKit: { setAlpha: (...args: unknown[]) => mockSetAlpha(...args) } }));
jest.mock('@/heroui/helpers/internal/components', () => ({ HeroText: require('react-native').Text }));
jest.mock('@/heroui/components/pressable-feedback', () => {
  const { View } = require('react-native');
  return { PressableFeedback: Object.assign(View, { Highlight: View, Ripple: View }) };
});
import { Button } from '@/heroui/components/button';

beforeEach(() => jest.clearAllMocks());
test.each(['outline', 'ghost'] as const)('%s skips unsupported CSS color conversion when feedback is disabled', variant => {
  let tree: renderer.ReactTestRenderer;
  act(() => { tree = renderer.create(<Button variant={variant} feedbackVariant="none"><Text>操作</Text></Button>); });
  expect(mockSetAlpha).not.toHaveBeenCalled();
  act(() => tree.unmount());
});

test('disable-all skips color conversion even with the default feedback variant', () => {
  let tree: renderer.ReactTestRenderer;
  act(() => { tree = renderer.create(<Button variant="outline" animation="disable-all"><Text>操作</Text></Button>); });
  expect(mockSetAlpha).not.toHaveBeenCalled();
  act(() => tree.unmount());
});
