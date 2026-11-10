import { Stack } from "expo-router";
import "../global.css";
import { Provider } from "@/components/Provider";
import { ThemeProvider } from "@/contexts/ThemeContext";

export default function RootLayout() {
  return (
    <>
      <ThemeProvider>
        <Provider>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="login" />
            <Stack.Screen name="register" />
            <Stack.Screen name="onboarding" />
            <Stack.Screen name="profile-edit" />
            <Stack.Screen name="profile-settings" />
            <Stack.Screen name="search" options={{ animation: "fade" }} />
            <Stack.Screen name="recipe-detail" />
            <Stack.Screen name="recipe-submit" />
            <Stack.Screen name="favorites" />
            <Stack.Screen name="following" />
            <Stack.Screen name="user-profile" />
            <Stack.Screen name="diet-record" />
            <Stack.Screen name="prepared-meals" />
            <Stack.Screen name="cooking-plan" />
            <Stack.Screen name="health-data" />
            <Stack.Screen name="health-profile" />
            <Stack.Screen name="cooking-queue" />
            <Stack.Screen name="meal-plans" />
            <Stack.Screen name="inventory-insights" />
            <Stack.Screen name="cooking-mode" />
            <Stack.Screen name="post-detail" />
            <Stack.Screen name="post-create" />
            <Stack.Screen
              name="ai-assistant"
              options={{
                // 使用全屏页面承载食语；仅保留自下而上的转场。
                // `presentation: "modal"` 在 Web 会将页面缩成圆角浮层，露出四角背景。
                animation: "slide_from_bottom",
              }}
            />
            <Stack.Screen name="settings" />
            <Stack.Screen name="password" />
            <Stack.Screen name="forgot-password" />
            <Stack.Screen name="notifications" />
            <Stack.Screen name="shopping-list" />
            <Stack.Screen name="legal" />
            <Stack.Screen name="about" />
            <Stack.Screen name="feedback" />
            <Stack.Screen name="feedback-history" />
            <Stack.Screen name="custom-food" />
            <Stack.Screen name="household-dining" />
            <Stack.Screen name="household-meals" />
            <Stack.Screen name="household-production" />
            <Stack.Screen name="intervention-settings" />
            <Stack.Screen name="intervention" />
            <Stack.Screen name="maintenance-results" />
            <Stack.Screen name="plan-maintenance" />
            <Stack.Screen name="preference-learning" />
            <Stack.Screen name="weekly-plan" />
          </Stack>
        </Provider>
      </ThemeProvider>
    </>
  );
}
