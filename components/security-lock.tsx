import { Ionicons } from "@expo/vector-icons";
import * as LocalAuthentication from "expo-local-authentication";
import { Button, useThemeColor } from "heroui-native";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { Text, View } from "react-native";

export function SecurityLock({ children }: PropsWithChildren) {
  const accentColor = useThemeColor("accent");
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const promptedRef = useRef(false);

  const authenticate = useCallback(async () => {
    setIsAuthenticating(true);
    setError(null);

    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();

      if (!hasHardware && !isEnrolled) {
        setIsUnlocked(true);
        return;
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock Spaza OS",
        cancelLabel: "Cancel",
        fallbackLabel: "Use device PIN",
        disableDeviceFallback: false,
      });

      if (result.success || result.error === "passcode_not_set") {
        setIsUnlocked(true);
      } else {
        setError("Locked. Tap unlock to try again.");
      }
    } catch {
      setError("Could not verify your identity. Tap unlock to try again.");
    } finally {
      setIsAuthenticating(false);
    }
  }, []);

  useEffect(() => {
    if (promptedRef.current) return;
    promptedRef.current = true;
    void authenticate();
  }, [authenticate]);

  if (isUnlocked) {
    return <>{children}</>;
  }

  return (
    <View className="flex-1 items-center justify-center bg-background px-8">
      <View className="mb-6 h-20 w-20 items-center justify-center rounded-full bg-surface-secondary">
        <Ionicons name="lock-closed" size={34} color={accentColor} />
      </View>
      <Text className="mb-2 text-2xl font-bold text-foreground">Spaza OS</Text>
      <Text className="mb-8 text-center text-sm text-muted">
        Your stock, sales and customer tabs stay on this phone. Unlock with your
        fingerprint, face, or device PIN.
      </Text>
      <Button
        size="lg"
        isDisabled={isAuthenticating}
        onPress={() => void authenticate()}
      >
        <Ionicons name="finger-print" size={20} color="#ffffff" />
        <Button.Label>{isAuthenticating ? "Unlocking..." : "Unlock"}</Button.Label>
      </Button>
      {error ? (
        <Text className="mt-4 text-center text-sm text-danger">{error}</Text>
      ) : null}
    </View>
  );
}
