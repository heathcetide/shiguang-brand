import { Tabs } from 'expo-router';
import { AppTabBar } from '@/components/AppTabBar';

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <AppTabBar {...props} />}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '首页',
        }}
      />
      <Tabs.Screen
        name="inventory"
        options={{
          title: '膳食资产',
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          title: '社区',
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: '我的',
        }}
      />
    </Tabs>
  );
}
