import "@/global.css";
import { Stack } from "expo-router";
import { HeroUINativeProvider } from "heroui-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { SecurityLock } from "@/components/security-lock";
import { AppThemeProvider } from "@/contexts/app-theme-context";
import { useAutoSync } from "@/hooks/use-auto-sync";

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

function AppStack() {
  useAutoSync();

  return (
    <Stack screenOptions={{}}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function Layout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <AppThemeProvider>
          <HeroUINativeProvider>
            <SecurityLock>
              <AppStack />
            </SecurityLock>
          </HeroUINativeProvider>
        </AppThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
