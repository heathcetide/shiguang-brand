import { FlatList, Modal, Text, TouchableOpacity, View } from "react-native";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import { useCSSVariable } from "uniwind";

import type { ShoppingItem } from "@/utils/shoppingList";
import type { ChatSession } from "./types";

interface HistoryDrawerProps {
  visible: boolean;
  sessions: ChatSession[];
  currentSessionId: string | null;
  onClose: () => void;
  onNewChat: () => void;
  onSelect: (session: ChatSession) => void;
  onDelete: (sessionId: string) => void;
}

export function HistoryDrawer({
  visible,
  sessions,
  currentSessionId,
  onClose,
  onNewChat,
  onSelect,
  onDelete,
}: HistoryDrawerProps) {
  const [brand, ink, muted] = useCSSVariable([
    "--color-brand",
    "--color-ink",
    "--color-copy-muted",
  ]) as string[];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-black/50 justify-end">
        <View className="bg-canvas rounded-t-3xl p-page max-h-[80%] border-t border-line shadow-2xl" accessibilityViewIsModal>
          <DrawerHeader icon="clock-rotate-left" iconColor={brand} title="历史对话记录" onClose={onClose} closeColor={ink} />
          <TouchableOpacity
            onPress={onNewChat}
            className="my-3 bg-brand-fill min-h-touch px-4 rounded-control flex-row items-center justify-center gap-2 active:bg-accent-hover"
            accessibilityRole="button"
            accessibilityLabel="开启新的对话"
          >
            <FontAwesome6 name="plus" size={14} colorClassName="accent-on-brand" />
            <Text className="text-body font-bold text-white">开启新的对话</Text>
          </TouchableOpacity>

          <FlatList
            data={sessions}
            keyExtractor={(session) => session.id}
            className="max-h-[400px]"
            contentContainerStyle={{ gap: 6 }}
            accessibilityLiveRegion="polite"
            ListEmptyComponent={<View className="items-center py-8"><Text className="text-caption text-copy-muted">暂无历史对话记录</Text></View>}
            renderItem={({ item: session }) => (
              <View className={`p-3.5 my-1 rounded-card border flex-row items-center justify-between ${session.id === currentSessionId ? "bg-brand-soft border-brand" : "bg-surface border-line"}`}>
                <TouchableOpacity
                  onPress={() => onSelect(session)}
                  className="flex-1 mr-3 min-h-touch justify-center"
                  accessibilityRole="button"
                  accessibilityLabel={`${session.title}，${session.messages?.length || 0} 条对话`}
                  accessibilityState={{ selected: session.id === currentSessionId }}
                >
                  <Text className="text-caption font-black text-ink mb-1" numberOfLines={1}>{session.title}</Text>
                  <Text className="text-caption text-copy-muted">{session.updatedAt} · {session.messages?.length || 0} 条对话</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => onDelete(session.id)}
                  className="min-w-touch min-h-touch rounded-full bg-background-secondary items-center justify-center"
                  accessibilityRole="button"
                  accessibilityLabel={`删除对话：${session.title}`}
                >
                  <FontAwesome6 name="trash-can" size={12} color={muted} />
                </TouchableOpacity>
              </View>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}

interface ShoppingListDrawerProps {
  visible: boolean;
  items: ShoppingItem[];
  onClose: () => void;
  onRemove: (itemId: string) => void;
}

export function ShoppingListDrawer({ visible, items, onClose, onRemove }: ShoppingListDrawerProps) {
  const [brand, ink, highlight] = useCSSVariable([
    "--color-brand",
    "--color-ink",
    "--color-highlight",
  ]) as string[];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-black/50 justify-end">
        <View className="bg-canvas rounded-t-3xl p-page max-h-[80%] border-t border-line shadow-2xl" accessibilityViewIsModal>
          <DrawerHeader icon="cart-shopping" iconColor={highlight} title="我的智能采购清单" onClose={onClose} closeColor={ink} />
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            className="my-3 max-h-[400px]"
            contentContainerStyle={{ gap: 6 }}
            accessibilityLiveRegion="polite"
            ListEmptyComponent={(
              <View className="items-center py-10 bg-surface/60 rounded-card border border-dashed border-line">
                <FontAwesome6 name="basket-shopping" size={28} color={highlight} />
                <Text className="text-caption text-copy-muted mt-2 font-bold">采购清单空空如也</Text>
                <Text className="text-caption text-copy-muted mt-1">在 AI 聊天中点【想吃菜品】，缺料会自动加入哦！</Text>
              </View>
            )}
            renderItem={({ item }) => (
              <View className="p-3 my-1 rounded-card bg-surface border border-line flex-row items-center justify-between shadow-2xs">
                <View className="flex-1 mr-3 flex-row items-center gap-2">
                  <View className="w-7 h-7 rounded-full bg-warning-soft items-center justify-center">
                    <FontAwesome6 name="carrot" size={12} color={highlight} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-caption font-black text-ink">{item.name}</Text>
                    <Text className="text-caption text-copy-muted">规格/用量: {item.amount}</Text>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => onRemove(item.id)}
                  className="bg-brand-soft min-h-touch px-2.5 rounded-control flex-row items-center gap-1"
                  accessibilityRole="button"
                  accessibilityLabel={`标记 ${item.name} 已买到`}
                >
                  <FontAwesome6 name="check" size={10} color={brand} />
                  <Text className="text-caption font-bold text-brand">已买到</Text>
                </TouchableOpacity>
              </View>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}

function DrawerHeader({ icon, iconColor, title, onClose, closeColor }: {
  icon: string;
  iconColor: string;
  title: string;
  onClose: () => void;
  closeColor: string;
}) {
  return (
    <View className="flex-row items-center justify-between pb-3 border-b border-line">
      <View className="flex-row items-center gap-2 flex-1">
        <FontAwesome6 name={icon as never} size={16} color={iconColor} />
        <Text className="text-base font-black text-ink" accessibilityRole="header">{title}</Text>
      </View>
      <TouchableOpacity
        onPress={onClose}
        className="min-w-touch min-h-touch rounded-full bg-surface items-center justify-center border border-line"
        accessibilityRole="button"
        accessibilityLabel={`关闭${title}`}
      >
        <FontAwesome6 name="xmark" size={14} color={closeColor} />
      </TouchableOpacity>
    </View>
  );
}
