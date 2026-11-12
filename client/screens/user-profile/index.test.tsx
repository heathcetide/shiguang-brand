import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';

const mockProfile = jest.fn();
const mockFollow = jest.fn();
const mockFetch = jest.fn();
const mockRouter = { push: jest.fn(), back: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn(() => true), replace: jest.fn() };
jest.mock('@/services/api', () => ({ communityApi: { userProfile: (...args: unknown[]) => mockProfile(...args), toggleFollow: (...args: unknown[]) => mockFollow(...args) } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 1 }, isAuthenticated: true }), useAuthFetch: () => mockFetch }));
jest.mock('@/hooks/useSafeRouter', () => ({ useSafeRouter: () => mockRouter, useSafeSearchParams: () => ({ userId: 2 }) }));
jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]) }));
jest.mock('@/components/Screen', () => ({ Screen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/ThemedFontAwesome6', () => () => null);
jest.mock('@/heroui/components/button', () => ({
  Button: ({ isDisabled, ...props }: { isDisabled?: boolean; children?: React.ReactNode }) =>
    require('react').createElement(require('react-native').TouchableOpacity, { ...props, disabled: isDisabled }),
}));
jest.mock('@/utils/defaultAvatar', () => ({ getAvatarSource: () => ({ uri: 'avatar' }) }));
import UserProfileScreen from './index';

const minimal = { id: 2, username: '食友', avatar_url: null, bio: null, following: false };
const full = { ...minimal, followers_count: 3, following_count: 2, posts_count: 1, is_following: false,
  level: { level: 2, title: '轻食探索者', xp: 180, nextXp: 450, progress: 10 },
  posts: [{ id: 7, content: '今天做了蔬菜汤', image_url: null, likes_count: 4, created_at: '2026-11-11' }] };
let tree: renderer.ReactTestRenderer;
const text = () => tree.root.findAllByType(Text).map(node => node.props.children).flat(Infinity).join('');
async function mount(profile: unknown) {
  mockProfile.mockResolvedValue(profile);
  await act(async () => { tree = renderer.create(<UserProfileScreen />); });
}
async function press(label: string) {
  const button = tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(child => child.props.children === label))!;
  await act(async () => { await button.props.onPress(); });
}
beforeEach(() => { jest.clearAllMocks(); mockRouter.canGoBack.mockReturnValue(true); });
afterEach(() => { if (tree) act(() => tree.unmount()); });

test('minimal Go profile renders an empty feed without missing-data warnings or crashes', async () => {
  await mount(minimal);
  expect(text()).toContain('食友');
  expect(text()).toContain('还没有分享日常');
  expect(text()).not.toContain('暂不可用');
  expect(text()).not.toContain('V1');
  expect(text()).not.toContain('XP');
  expect(text()).not.toContain('满级');
  expect(text()).not.toContain('NaN');
});

test.each([undefined, null, 0])('empty profile counts (%s) display zero in the text and accessible label', async value => {
  await mount({ ...minimal, posts_count: value, following_count: value, followers_count: value });
  for (const label of ['动态', '关注', '粉丝']) {
    const stat = tree.root.findByProps({ accessibilityLabel: `${label}：0` });
    expect(stat.findAllByType(Text)[0].props.children).toBe(0);
  }
  expect(text()).not.toContain('—');
  expect(text()).not.toContain('暂无统计');
});

test('null level and an empty posts array render a real empty state', async () => {
  await mount({ ...full, level: null, posts: [], posts_count: 0 });
  expect(text()).not.toContain('等级信息暂不可用');
  expect(text()).toContain('还没有分享日常');
  expect(text()).not.toContain('动态信息暂不可用');
});

test('complete profile preserves the supplied level and posts, including navigation', async () => {
  await mount(full);
  expect(text()).toContain('V2 · 轻食探索者');
  expect(text()).toContain('成长经验 180 XP');
  expect(text()).toContain('10%');
  expect(text()).toContain('今天做了蔬菜汤');
  for (const [label, count] of [['动态', 1], ['关注', 2], ['粉丝', 3]] as const) {
    const stat = tree.root.findByProps({ accessibilityLabel: `${label}：${count}` });
    expect(stat.findAllByType(Text)[0].props.children).toBe(count);
  }
  await press('今天做了蔬菜汤');
  expect(mockRouter.push).toHaveBeenCalledWith('/post-detail', { id: 7 });
});

test('legacy following alias is honored and a follow toggle uses the confirmed server state', async () => {
  await mount({ ...minimal, following: true, followers_count: 3, posts: [] });
  expect(text()).toContain('已关注');
  mockFollow.mockResolvedValue({ is_following: false, following_count: 0 });
  await press('已关注');
  expect(mockFollow).toHaveBeenCalledWith(mockFetch, 2);
  expect(text()).toContain('关注 TA');
  expect(text()).not.toContain('NaN');
});

test('missing follower counts start at zero and update after following and unfollowing', async () => {
  await mount(minimal);
  expect(tree.root.findByProps({ accessibilityLabel: '粉丝：0' })).toBeDefined();
  mockFollow.mockResolvedValueOnce({ is_following: true, following_count: 1 });
  await press('关注 TA');
  expect(text()).toContain('已关注');
  expect(tree.root.findByProps({ accessibilityLabel: '粉丝：1' })).toBeDefined();
  mockFollow.mockResolvedValueOnce({ is_following: false, following_count: 0 });
  await press('已关注');
  expect(tree.root.findByProps({ accessibilityLabel: '粉丝：0' })).toBeDefined();
  expect(text()).not.toContain('NaN');
});

test('self profile has working edit and first-post actions instead of a follow button', async () => {
  await mount({ ...full, id: 1, posts: [], level: null });
  expect(text()).toContain('从今天的第一餐开始吧');
  expect(text()).not.toContain('关注 TA');
  await press('编辑资料');
  expect(mockRouter.push).toHaveBeenCalledWith('/profile-edit');
  await press('记录第一篇日常');
  expect(mockRouter.push).toHaveBeenCalledWith('/post-create');
});

test('a failed follow rolls back the state and displays retry guidance', async () => {
  await mount(full);
  mockFollow.mockRejectedValueOnce(new Error('Network unavailable'));
  await press('关注 TA');
  expect(text()).toContain('关注 TA');
  expect(text()).toContain('没有操作成功，请再试一次');
});

test('directly opened profiles return to the community when there is no history', async () => {
  mockRouter.canGoBack.mockReturnValue(false);
  await mount(full);
  const back = tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === '返回社区')!;
  act(() => back.props.onPress());
  expect(mockRouter.replace).toHaveBeenCalledWith('/community');
});

test('failed profile fetch can be retried instead of looking like an empty feed', async () => {
  mockProfile.mockRejectedValueOnce(new Error('Unavailable'));
  await act(async () => { tree = renderer.create(<UserProfileScreen />); });
  expect(text()).toContain('这页暂时没有打开');
  expect(text()).not.toContain('还没有分享日常');
  mockProfile.mockResolvedValueOnce(full);
  await press('重新加载');
  expect(text()).toContain('今天做了蔬菜汤');
});
