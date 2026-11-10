import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// These settings dialogs own keyboard handling; Screen deliberately stops at Modal.
export function SettingsModal({ visible, onClose, children, sheet = false }: {
  visible: boolean; onClose: () => void; children: ReactNode; sheet?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return <Modal visible={visible} transparent animationType={sheet ? "slide" : "fade"} onRequestClose={onClose}>
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
      <View className="flex-1 bg-black/50" style={{ paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }}>
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ flexGrow: 1, justifyContent: sheet ? "flex-end" : "center", padding: sheet ? 0 : 24 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="取消并关闭弹窗" onPress={onClose} style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0 }} />
          <View accessibilityViewIsModal>{children}</View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}
