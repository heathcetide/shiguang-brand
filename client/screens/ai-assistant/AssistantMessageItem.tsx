import { InventoryFieldEvidence } from "@/components/InventoryFieldEvidence";
import { approvalFields, editApprovalField, getActionScopeDescription, isEditableAction } from "./approvalFields";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import { AIMarkdown } from "@/components/AIMarkdown";
import { getAvatarSource } from "@/utils/defaultAvatar";
import { useAuthFetch } from "@/contexts/AuthContext";
import { aiApi } from "@/services/api";
import type {
  DietRecordActionCard,
  AIWriteConfirmation,
  DietRecordMissingCard,
  InventoryScanCard,
  InventoryScanFood,
  Message,
  AgentActionProposal,
  SolutionCard,
} from "./types";

type AssistantMessageItemProps = {
  message: Message;
  userAvatarUrl?: string | null;
  userAvatarSeed?: number | string;
  handleConfirmRecordCard: (messageId: string, card: DietRecordActionCard, isTomorrow?: boolean, confirmation?: AIWriteConfirmation) => void | Promise<void>;
  handleCommitWriteConfirmation: (messageId: string, confirmation: AIWriteConfirmation) => void | Promise<void>;
  handleOpenEditModal: (messageId: string, card: DietRecordActionCard) => void;
  toggleInventoryScanItem: (messageId: string, itemId: string) => void;
  openInventoryScanEditor: (messageId: string, item: InventoryScanFood) => void;
  undoInventoryScanCard: (messageId: string, card: InventoryScanCard) => void | Promise<void>;
  confirmInventoryScanCard: (messageId: string, card: InventoryScanCard) => void | Promise<void>;
  handleSaveToShoppingList: (messageId: string, card: DietRecordMissingCard) => void | Promise<void>;
  handleSendMessage: (text: string) => void | Promise<void>;
  onStartCooking: (card: SolutionCard) => void;
  onSaveRecipe: (messageId: string, card: SolutionCard) => void | Promise<void>;
  onOpenInventory: () => void;
  onOpenInventoryAdd: () => void;
  onAgentResume: (messageId: string, runId: string, decision: "approve" | "reject" | "edit", actions?: AgentActionProposal[]) => void | Promise<void>;
  onAgentCancel: (messageId: string, runId: string) => void | Promise<void>;
  onAgentRetry: (messageId: string, runId: string) => void | Promise<void>;
  onAgentUndo: (messageId: string, runId: string) => void | Promise<void>;
};

export function AssistantMessageItem({
  message: msg,
  userAvatarUrl,
  userAvatarSeed,
  handleConfirmRecordCard,
  handleCommitWriteConfirmation,
  handleOpenEditModal,
  toggleInventoryScanItem,
  openInventoryScanEditor,
  confirmInventoryScanCard,
  undoInventoryScanCard,
  handleSaveToShoppingList,
  handleSendMessage,
  onStartCooking,
  onSaveRecipe,
  onOpenInventory,
  onOpenInventoryAdd,
  onAgentResume,
  onAgentCancel,
  onAgentRetry,
  onAgentUndo,
}: AssistantMessageItemProps) {
  const authFetch = useAuthFetch();
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editedActions, setEditedActions] = useState<AgentActionProposal[]>([]);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [attachmentUri, setAttachmentUri] = useState(msg.imageUri);
  const [attachmentLoading, setAttachmentLoading] = useState(!msg.imageUri && Boolean(msg.imageRunId));
  const [attachmentPreviewVisible, setAttachmentPreviewVisible] = useState(false);
  const [attachmentFetchAttempted, setAttachmentFetchAttempted] = useState(false);
  const agent = msg.agentRun;
  const isAgentActive = agent?.run.status === "queued" || agent?.run.status === "running" || agent?.run.status === "awaiting_input";
  const displayedDurationMs = agent ? agent.run.durationMs : msg.responseTimeMs;
  const hasUndo = agent?.actions?.some((action) => action.undoAvailableUntil && Date.parse(action.undoAvailableUntil) > Date.now())
    && agent.undoState !== "completed";


  useEffect(() => {
    setAttachmentUri(msg.imageUri);
    setAttachmentFetchAttempted(false);
    setAttachmentLoading(!msg.imageUri && Boolean(msg.imageRunId));
  }, [msg.id, msg.imageRunId, msg.imageUri]);

  const loadPersistedAttachment = useCallback(async () => {
    if (!msg.imageRunId || attachmentFetchAttempted) return;
    setAttachmentFetchAttempted(true);
    setAttachmentLoading(true);
    try {
      const media = await aiApi.agentMedia<{ dataUrl: string }>(authFetch, msg.imageRunId);
      setAttachmentUri(media.dataUrl);
    } catch {
      setAttachmentUri(undefined);
    } finally {
      setAttachmentLoading(false);
    }
  }, [attachmentFetchAttempted, authFetch, msg.imageRunId]);

  useEffect(() => {
    if (!attachmentUri && msg.imageRunId) void loadPersistedAttachment();
  }, [attachmentUri, loadPersistedAttachment, msg.imageRunId]);

  const runAgentAction = async (action: () => void | Promise<void>) => {
    if (approvalBusy) return false;
    setApprovalBusy(true);
    setActionError(null);
    setEditorError(null);
    try { await action(); return true; } catch (error) {
      const message = error instanceof Error ? error.message : "请重试或刷新任务状态";
      setActionError(message);
      setEditorError(message);
      return false;
    } finally { setApprovalBusy(false); }
  };

  const openApprovalEditor = () => {
    setEditedActions((agent?.run.pendingApproval?.actions || []).map((action) => ({ ...action, payload: { ...action.payload } })));
    setEditorError(null);
    setEditorVisible(true);
  };

  const submitEditedApproval = async () => {
    try {
      const success = await runAgentAction(() => onAgentResume(msg.id, agent!.run.id, editedActions.length ? "edit" : "reject", editedActions));
      if (success) setEditorVisible(false);
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "批准内容格式无效");
    }
  };

  return (
                <View
                  key={msg.id}
                  className={`mb-4 flex-row ${
                    msg.sender === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  {msg.sender === "ai" && (
                    <Image
                      source={require("@/assets/shiyu-avatar.jpg")}
                      className="w-9 h-9 rounded-full border border-highlight mr-2.5 mt-0.5 shadow-xs"
                      resizeMode="cover"
                    />
                  )}

                  <View
                    className={`${msg.inventoryScanCard ? "max-w-[90%]" : "max-w-[78%]"} p-4 rounded-3xl shadow-xs ${
                      msg.sender === "user"
                        ? "bg-brand-fill rounded-tr-none"
                        : msg.status === "failed"
                          ? "bg-danger-soft border border-critical/40 rounded-tl-none"
                          : "bg-surface border border-line rounded-tl-none"
                    }`}
                  >
                    {msg.imageUri || msg.imageRunId ? (
                      <TouchableOpacity
                        disabled={!attachmentUri}
                        onPress={() => setAttachmentPreviewVisible(true)}
                        className="mb-2.5 h-36 w-48 overflow-hidden rounded-2xl border border-white/20"
                      >
                        {attachmentUri ? (
                          <Image
                            source={{ uri: attachmentUri }}
                            className="h-full w-full"
                            resizeMode="cover"
                            onError={() => {
                              if (msg.imageRunId && !attachmentFetchAttempted) {
                                setAttachmentUri(undefined);
                              }
                            }}
                          />
                        ) : (
                          <View className="h-full w-full items-center justify-center bg-background-secondary">
                            {attachmentLoading ? <ActivityIndicator size="small" colorClassName="accent-brand" /> : <FontAwesome6 name="image" size={18} colorClassName="accent-copy-muted" />}
                            <Text className="mt-2 text-[9px] text-copy-muted">{attachmentLoading ? "正在恢复图片" : "图片已不可用"}</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    ) : null}
                    {msg.sender === "ai" ? (
                      <AIMarkdown content={msg.text} />
                    ) : (
                      <Text className="text-xs leading-6 font-bold text-white">
                        {msg.text}
                      </Text>
                    )}
                    {msg.sender === "ai" && typeof displayedDurationMs === "number" ? (
                      <Text className="mt-1 text-[9px] font-medium text-copy-muted">
                        {agent ? "任务历时（含等待）" : "回复耗时"} {displayedDurationMs < 1000 ? `${Math.round(displayedDurationMs)} ms` : `${(displayedDurationMs / 1000).toFixed(2)} 秒`}
                      </Text>
                    ) : null}

                    {agent ? (
                      <View className="mt-3 overflow-hidden rounded-2xl border border-brand/25 bg-background-secondary">
                        <View className="flex-row items-center justify-between border-b border-line px-3 py-2.5">
                          <View className="flex-row items-center gap-2">
                            {isAgentActive ? <ActivityIndicator size="small" colorClassName="accent-brand" /> : (
                              <FontAwesome6
                                name={agent.run.status === "completed" ? "circle-check" : agent.run.status === "awaiting_approval" ? "shield-halved" : agent.run.status === "awaiting_input" ? "circle-question" : "circle-exclamation"}
                                size={12}
                                colorClassName={agent.run.status === "failed" ? "accent-critical" : "accent-brand"}
                              />
                            )}
                            <Text className="text-xs font-black text-ink">食语任务</Text>
                          </View>
                          <Text className="text-[9px] font-bold text-brand">
                            {agent.run.status === "queued" ? "排队中"
                              : agent.run.status === "running" ? "执行中"
                                : agent.run.status === "awaiting_input" ? "等待补充"
                                : agent.run.status === "awaiting_approval" ? "等待批准"
                                  : agent.run.status === "completed" ? "已完成"
                                    : agent.run.status === "cancelled" ? "已取消" : agent.run.status === "expired" ? "已过期" : "执行失败"}
                          </Text>
                        </View>

                        {agent.events.length ? (
                          <View className="gap-2 px-3 py-2.5">
                            {agent.events.filter((event) => event.eventType !== "reply_delta").slice(-6).map((event) => (
                              <View key={event.sequence} className="flex-row items-start gap-2">
                                <View className="mt-1.5 h-1.5 w-1.5 rounded-full bg-brand-fill" />
                                <View className="flex-1">
                                  <Text className="text-[9px] font-black text-brand">{({ Supervisor: "食语助手", PolicyGate: "安全检查", OperationsAgent: "业务操作", NutritionPlanningAgent: "营养规划", RecipeCookingAgent: "菜谱建议", VisionAgent: "图片识别", VoiceAgent: "语音转写" })[event.agentName]}</Text>
                                  <Text className="mt-0.5 text-[10px] leading-4 text-copy-muted">{event.summary}</Text>
                                </View>
                              </View>
                            ))}
                          </View>
                        ) : (
                          <Text className="px-3 py-3 text-[10px] text-copy-muted">任务已经创建，正在等待公开步骤…</Text>
                        )}

                        {actionError ? <Text accessibilityRole="alert" className="px-3 py-2 text-xs text-critical">{actionError}</Text> : null}
                        {agent.connectionError ? <Text accessibilityRole="alert" className="px-3 py-2 text-xs text-copy-muted">连接暂时中断，正在重新查询原任务；不会重复提交。</Text> : null}
                        {agent.actions?.length ? <View className="border-t border-line p-3 gap-1">
                          {agent.actions.map((action) => <Text key={action.id} className="text-xs text-copy-muted">{action.name || "业务操作"} · {({ executed: "已执行", proposed: "待处理", awaiting_approval: "待批准", rejected: "已拒绝", failed: "执行失败", undone: "已撤销" } as Record<string, string>)[action.status] || "处理中"}</Text>)}
                        </View> : null}
                        {agent.run.pendingApproval ? (
                          <View className="border-t border-line bg-surface px-3 py-3">
                            <Text className="text-xs font-black text-ink">需要你确认的操作</Text>
                            {agent.run.pendingApproval.actions.map((action, index) => (
                              <View key={action.id || `${action.actionType}-${index}`} className="mt-2 rounded-xl bg-canvas px-2.5 py-2">
                                <Text className="text-[10px] font-bold text-ink">{action.summary}</Text>
                                <Text className="mt-0.5 text-[9px] text-copy-muted">此项待批准；已执行项见上方操作记录</Text>
                              </View>
                            ))}
                            <View className="mt-3 flex-row gap-2">
                              <TouchableOpacity disabled={approvalBusy} onPress={() => void runAgentAction(() => onAgentResume(msg.id, agent.run.id, "reject"))} className="flex-1 items-center rounded-xl border border-line bg-surface py-2.5 disabled:opacity-50">
                                <Text className="text-xs font-bold text-copy-muted">拒绝</Text>
                              </TouchableOpacity>
                              <TouchableOpacity disabled={approvalBusy} onPress={openApprovalEditor} className="flex-1 items-center rounded-xl border border-brand/30 bg-brand/10 py-2.5 disabled:opacity-50">
                                <Text className="text-xs font-bold text-brand">编辑</Text>
                              </TouchableOpacity>
                              <TouchableOpacity disabled={approvalBusy} onPress={() => void runAgentAction(() => onAgentResume(msg.id, agent.run.id, "approve"))} className="flex-1 items-center rounded-xl bg-brand-fill py-2.5 disabled:opacity-50">
                                <Text className="text-xs font-bold text-white">批准</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        ) : null}

                        {agent.run.status === "awaiting_input" && agent.run.pendingInput ? (
                          <View className="border-t border-line bg-surface px-3 py-3">
                            <Text className="text-xs font-black text-ink">需要补充信息</Text>
                            <Text className="mt-1 text-[10px] leading-4 text-copy-muted">{agent.run.pendingInput.question}</Text>
                            <View className="mt-3 flex-row items-center gap-2 rounded-xl bg-brand/10 px-3 py-2.5">
                              <FontAwesome6 name="arrow-down" size={10} colorClassName="accent-brand" />
                              <Text className="flex-1 text-[10px] font-bold leading-4 text-brand">请在底部输入框回复，发送后将继续当前任务</Text>
                            </View>
                          </View>
                        ) : null}

                        {isAgentActive ? (
                          <TouchableOpacity disabled={approvalBusy} onPress={() => void runAgentAction(() => onAgentCancel(msg.id, agent.run.id))} className="items-center border-t border-line py-2.5">
                            <Text className="text-[10px] font-bold text-copy-muted">取消任务</Text>
                          </TouchableOpacity>
                        ) : agent.run.status === "failed" ? (
                          <View className="border-t border-critical/30 bg-danger-soft px-3 py-3">
                            <Text className="text-[10px] leading-4 text-critical">{agent.run.error?.message || "Agent 执行失败"}</Text>
                            <TouchableOpacity disabled={approvalBusy} onPress={() => void runAgentAction(() => onAgentRetry(msg.id, agent.run.id))} className="mt-2 items-center rounded-xl bg-brand-fill py-2.5 disabled:opacity-50">
                              <Text className="text-xs font-bold text-white">重试任务</Text>
                            </TouchableOpacity>
                          </View>
                        ) : null}
                        {hasUndo ? (
                          <TouchableOpacity disabled={approvalBusy} onPress={() => void runAgentAction(() => onAgentUndo(msg.id, agent.run.id))} className="flex-row items-center justify-center gap-1.5 border-t border-line bg-success-soft py-2.5 disabled:opacity-50">
                            <FontAwesome6 name="rotate-left" size={9} colorClassName="accent-brand" />
                            <Text className="text-[10px] font-bold text-brand">撤销已执行操作（10 分钟内）</Text>
                          </TouchableOpacity>
                        ) : agent.undoState === "completed" ? (
                          <Text className="border-t border-line py-2.5 text-center text-[10px] font-bold text-copy-muted">操作已撤销</Text>
                        ) : null}
                      </View>
                    ) : null}

                    {/* Pre-filled Diet Record Action Card */}
                    {msg.actionCard && (
                      <View className="mt-3 bg-canvas p-3.5 rounded-2xl border border-highlight/60 shadow-xs">
                        <View className="flex-row items-center justify-between mb-2 pb-1.5 border-b border-line">
                          <View className="flex-row items-center gap-1.5">
                            <FontAwesome6 name="wand-magic-sparkles" size={12} colorClassName="accent-brand" />
                            <Text className="text-xs font-black text-ink">AI 自动识别待确认卡片</Text>
                          </View>
                          <View className="bg-brand-fill px-2 py-0.5 rounded-full">
                            <Text className="text-[10px] font-bold text-white">{msg.actionCard.mealType}</Text>
                          </View>
                        </View>

                        <Text className="text-xs font-black text-ink mb-1">
                          {msg.actionCard.foodName} ({msg.actionCard.amount})
                        </Text>
                        <Text className="text-[11px] text-copy-muted leading-4 mb-3">
                          预估热量: {msg.actionCard.calories} kcal | 蛋白质: {msg.actionCard.protein}g | 碳水: {msg.actionCard.carbs}g | 脂肪: {msg.actionCard.fat}g
                        </Text>

                        {msg.actionCard.saved ? (
                          <View className="bg-success-soft py-2 rounded-xl flex-row items-center justify-center gap-1.5 border border-success/30">
                            <FontAwesome6 name="circle-check" size={13} colorClassName="accent-brand" />
                            <Text className="text-xs font-bold text-brand">已成功保存至饮食日志</Text>
                          </View>
                        ) : (
                          <View className="gap-2">
                            <View className="flex-row items-center gap-2">
                              <TouchableOpacity
                                onPress={() => handleConfirmRecordCard(msg.id, msg.actionCard!, false, msg.writeConfirmation)}
                                className="flex-1 bg-brand-fill py-2 rounded-xl items-center shadow-xs active:opacity-90 flex-row justify-center gap-1"
                              >
                                <FontAwesome6 name="check" size={11} colorClassName="accent-on-brand" />
                                <Text className="text-xs font-bold text-white">记为今日已吃</Text>
                              </TouchableOpacity>

                              <TouchableOpacity
                                onPress={() => handleConfirmRecordCard(msg.id, msg.actionCard!, true, msg.writeConfirmation)}
                                className="bg-warm-fill px-3 py-2 rounded-xl items-center active:opacity-90 flex-row justify-center gap-1 shadow-2xs"
                              >
                                <FontAwesome6 name="calendar-plus" size={11} colorClassName="accent-on-brand" />
                                <Text className="text-xs font-bold text-white">存为明日计划</Text>
                              </TouchableOpacity>
                            </View>

                            <TouchableOpacity
                              onPress={() => handleOpenEditModal(msg.id, msg.actionCard!)}
                              className="bg-surface py-1.5 rounded-xl border border-line items-center active:opacity-90 flex-row justify-center gap-1"
                            >
                              <FontAwesome6 name="pen-to-square" size={10} colorClassName="accent-copy-muted" />
                              <Text className="text-[11px] font-bold text-copy-muted">弹出微调数据</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    )}

                    {msg.writeConfirmation && !msg.writeConfirmation.committed && !msg.actionCard && (
                      <View className="mt-3 rounded-2xl border border-brand/25 bg-background-secondary p-3">
                        <Text className="text-xs font-black text-ink">请确认本次操作</Text>
                        <Text className="mt-1 text-[11px] leading-4 text-copy-muted">
                          {msg.writeConfirmation.action === "add_inventory_item" ? `加入库存：${String(msg.writeConfirmation.payload.name || "")}`
                            : msg.writeConfirmation.action === "add_kitchenware_item" ? `加入厨具：${String(msg.writeConfirmation.payload.name || "")}`
                              : "更新健康数据"}
                        </Text>
                        <TouchableOpacity onPress={() => handleCommitWriteConfirmation(msg.id, msg.writeConfirmation!)} className="mt-3 items-center rounded-xl bg-brand-fill py-2.5">
                          <Text className="text-xs font-bold text-white">确认保存</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {msg.inventoryScanCard && (
                      <View className="mt-3 rounded-2xl border border-brand/25 bg-background-secondary p-3.5">
                        <View className="flex-row items-center justify-between border-b border-line pb-2.5">
                          <View className="flex-row items-center gap-2">
                            <View className="h-7 w-7 items-center justify-center rounded-xl bg-brand-fill">
                              <FontAwesome6 name="basket-shopping" size={11} colorClassName="accent-on-brand" />
                            </View>
                            <View>
                              <Text className="text-xs font-black text-ink">食材识别确认</Text>
                              <Text className="mt-0.5 text-[9px] text-copy-muted">
                                {msg.inventoryScanCard.status === "processing" ? "后台识别中，可停留查看进度" : msg.inventoryScanCard.status === "undone" ? "本次入库已撤销" : msg.inventoryScanCard.status === "saved" ? "识别项目已保存" : `待确认 ${msg.inventoryScanCard.items.length} 项，可逐项修改`}
                              </Text>
                            </View>
                          </View>
                          <View className="rounded-full bg-surface px-2 py-1">
                            <Text className="text-[9px] font-bold text-brand">
                              {msg.inventoryScanCard.status === "processing" ? "识别中" : msg.inventoryScanCard.status === "undone" ? "已撤销" : msg.inventoryScanCard.status === "saved" ? "已入库" : "待确认"}
                            </Text>
                          </View>
                        </View>

                        {msg.inventoryScanCard.status === "processing" ? (
                          <View className="items-center py-6">
                            <ActivityIndicator colorClassName="accent-brand" />
                            <Text className="mt-3 text-[11px] font-bold text-ink">食语正在整理照片中的食材</Text>
                            <Text className="mt-1 text-[9px] text-copy-muted">识别完成后会自动出现确认卡，不需要重复拍摄</Text>
                          </View>
                        ) : msg.inventoryScanCard.status === "failed" ? (
                          <View className="py-4">
                            <Text className="text-[11px] leading-5 text-critical">{msg.inventoryScanCard.error}</Text>
                            <TouchableOpacity
                              onPress={() => onOpenInventoryAdd()}
                              className="mt-3 items-center rounded-xl bg-brand-fill py-2.5"
                            >
                              <Text className="text-xs font-bold text-white">重新拍摄</Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <View className="mt-2.5 gap-2">
                            {msg.inventoryScanCard.lowConfidence ? (
                              <View className="flex-row items-start gap-2 rounded-xl border border-warm/30 bg-warm-soft px-3 py-2.5">
                                <FontAwesome6 name="triangle-exclamation" size={11} colorClassName="accent-warm" />
                                <Text className="flex-1 text-[10px] leading-4 text-warm">图片识别置信度较低，系统不会据此自动写入。请逐项核对名称、数量和保质期后再确认。</Text>
                              </View>
                            ) : null}
                            {msg.inventoryScanCard.items.map((item) => (
                              <View
                                key={item.id}
                                className={`flex-row items-center rounded-xl border px-2.5 py-2.5 ${item.selected ? "border-brand bg-surface" : "border-line bg-background-secondary opacity-55"}`}
                              >
                                <TouchableOpacity
                                  onPress={() => toggleInventoryScanItem(msg.id, item.id)}
                                  disabled={msg.inventoryScanCard?.status !== "review"}
                                  className={`mr-2.5 h-5 w-5 items-center justify-center rounded-full ${item.selected ? "bg-brand-fill" : "border border-line bg-surface"}`}
                                >
                                  {item.selected ? <FontAwesome6 name="check" size={9} colorClassName="accent-on-brand" /> : null}
                                </TouchableOpacity>
                                <View className="flex-1">
                                  <Text className="text-[11px] font-black text-ink" numberOfLines={1}>{item.foodName}</Text>
                                  <Text className="mt-0.5 text-[9px] text-copy-muted" numberOfLines={1}>
                                    {item.quantity || "数量待确认"}{item.fieldEvidence?.quantity?.status === "estimated" ? "（估计）" : ""} · {item.suggestedStorageLocation || "位置待确认"} · {item.estimatedExpireDays == null ? "期限待确认" : `建议 ${item.estimatedExpireDays} 天（待核对）`}
                                  </Text>
                                  <InventoryFieldEvidence evidence={item.fieldEvidence} />
                                </View>
                                {msg.inventoryScanCard?.status === "review" ? (
                                  <TouchableOpacity
                                    onPress={() => openInventoryScanEditor(msg.id, item)}
                                    className="ml-2 h-7 w-7 items-center justify-center rounded-lg bg-brand/10"
                                  >
                                    <FontAwesome6 name="pen" size={10} colorClassName="accent-brand" />
                                  </TouchableOpacity>
                                ) : null}
                              </View>
                            ))}

                            {msg.inventoryScanCard.canUndo ? <TouchableOpacity onPress={() => undoInventoryScanCard(msg.id, msg.inventoryScanCard!)} className="my-2 rounded-xl border border-line p-3"><Text className="text-center text-xs text-critical">撤销本次入库</Text></TouchableOpacity> : null}
                            {msg.inventoryScanCard.status === "undone" ? <Text className="py-2 text-xs text-copy-muted">已撤销，可到食材库查看当前库存。</Text> : msg.inventoryScanCard.status === "saved" ? (
                              <TouchableOpacity
                                onPress={() => onOpenInventory()}
                                className="mt-1 flex-row items-center justify-center gap-1.5 rounded-xl bg-success-soft py-2.5"
                              >
                                <FontAwesome6 name="circle-check" size={12} colorClassName="accent-brand" />
                                <Text className="text-xs font-black text-brand">已入库 · 查看食材库</Text>
                              </TouchableOpacity>
                            ) : (
                              <TouchableOpacity
                                onPress={() => confirmInventoryScanCard(msg.id, msg.inventoryScanCard!)}
                                disabled={msg.inventoryScanCard.status === "saving"}
                                className="mt-1 flex-row items-center justify-center gap-2 rounded-xl bg-brand-fill py-3 disabled:opacity-60"
                              >
                                {msg.inventoryScanCard.status === "saving" ? <ActivityIndicator size="small" colorClassName="accent-on-brand" /> : <FontAwesome6 name="check" size={11} colorClassName="accent-on-brand" />}
                                <Text className="text-xs font-black text-white">
                                  {msg.inventoryScanCard.status === "saving"
                                    ? "正在加入食材库…"
                                    : `确认加入 ${msg.inventoryScanCard.items.filter((item) => item.selected).length} 项`}
                                </Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        )}
                      </View>
                    )}

                    {/* Missing Ingredients Shopping Card */}
                    {msg.missingCard && (
                      <View className="mt-3 bg-warm/10 p-3.5 rounded-2xl border border-warm/30 shadow-xs">
                        <View className="flex-row items-center justify-between mb-2 pb-1.5 border-b border-warm/30">
                          <View className="flex-row items-center gap-1.5">
                            <FontAwesome6 name="basket-shopping" size={12} colorClassName="accent-warm" />
                            <Text className="text-xs font-black text-ink">缺料智能采购卡片</Text>
                          </View>
                          <View className="bg-warm-fill px-2 py-0.5 rounded-full">
                            <Text className="text-[10px] font-bold text-white">缺食材预警</Text>
                          </View>
                        </View>

                        <Text className="text-xs font-black text-ink mb-1.5">
                          想吃菜品: 【{msg.missingCard.dishName}】
                        </Text>

                        {/* 缺失食材列表 Chips */}
                        <View className="flex-row flex-wrap gap-1.5 mb-3">
                          {msg.missingCard.missingIngredients.map((item, idx) => (
                            <View key={idx} className="bg-surface px-2.5 py-1 rounded-xl border border-warm/30 flex-row items-center gap-1">
                              <FontAwesome6 name="circle-exclamation" size={9} colorClassName="accent-critical" />
                              <Text className="text-[10px] font-bold text-ink">{item.name}</Text>
                              <Text className="text-[9px] text-copy-muted font-medium">({item.amount})</Text>
                            </View>
                          ))}
                        </View>

                        {msg.missingCard.savedToList ? (
                          <View className="bg-warm-soft py-2 rounded-xl flex-row items-center justify-center gap-1.5 border border-warm/30">
                            <FontAwesome6 name="circle-check" size={13} colorClassName="accent-warm" />
                            <Text className="text-xs font-bold text-copy-muted">已存入采购清单</Text>
                          </View>
                        ) : (
                          <View className="flex-row items-center gap-2">
                            <TouchableOpacity
                              onPress={() => handleSaveToShoppingList(msg.id, msg.missingCard!)}
                              className="flex-1 bg-warm-fill py-2 rounded-xl items-center shadow-xs active:opacity-90 flex-row justify-center gap-1"
                            >
                              <FontAwesome6 name="cart-plus" size={11} colorClassName="accent-on-brand" />
                              <Text className="text-xs font-bold text-white">一键存入采购清单</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              onPress={() => handleSendMessage(`我冰箱里只有现有食材，请为我用冰箱里的食材替代推荐适合的料理！`)}
                              className="bg-surface px-3 py-2 rounded-xl border border-line items-center active:opacity-90 flex-row justify-center gap-1"
                            >
                              <FontAwesome6 name="wand-magic-sparkles" size={10} colorClassName="accent-brand" />
                              <Text className="text-[11px] font-bold text-brand">用现有食材替代</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    )}

                    {/* Option Choices Action Card (仅在无方案卡片时显示) */}
                    {msg.optionsCard && (!msg.solutionCards || msg.solutionCards.length === 0) && (
                      <View className="mt-3 bg-surface p-3 rounded-2xl border border-brand/30 shadow-xs">
                        <Text className="text-xs font-black text-brand mb-2 px-1">
                          {msg.optionsCard.title}
                        </Text>
                        <View className="gap-2">
                          {msg.optionsCard.options.map((opt, idx) => (
                            <TouchableOpacity
                              key={idx}
                              onPress={() => handleSendMessage(opt.actionText)}
                              className="bg-brand/10 border border-brand/20 py-2.5 px-3 rounded-xl flex-row items-center justify-between active:opacity-80"
                            >
                              <Text className="text-xs font-bold text-ink flex-1 mr-2" numberOfLines={1}>
                                {opt.label}
                              </Text>
                              <View className="bg-brand-fill px-2 py-0.5 rounded-lg flex-row items-center gap-1">
                                <Text className="text-[10px] font-bold text-white">选择此方案</Text>
                                <FontAwesome6 name="chevron-right" size={8} colorClassName="accent-on-brand" />
                              </View>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                    )}

                    {/* Rich Bento Solution Cards List (包含完整食材与做法细节) */}
                    {msg.solutionCards && msg.solutionCards.length > 0 && (
                      <View className="mt-3 gap-2.5">
                        <Text className="text-xs font-black text-brand px-1">
                          推荐的平替解决方案卡片（含完整食材与亮点）：
                        </Text>
                        {msg.solutionCards.map((card) => (
                          <View
                            key={card.id}
                            className="bg-surface rounded-2xl p-3.5 border border-brand/25 shadow-xs"
                          >
                            {/* 头部：方案 Tag + 菜名 */}
                            <View className="flex-row items-center justify-between mb-2 gap-2">
                              <View className="bg-brand-fill px-2.5 py-0.5 rounded-full shrink-0">
                                <Text className="text-[10px] font-black text-white">{card.schemeTag}</Text>
                              </View>
                              <View className="flex-1 items-end">
                                <Text className="text-xs font-black text-ink text-right" numberOfLines={1}>{card.title}</Text>
                                <Text className={`mt-0.5 text-[9px] font-bold ${card.source === "local" ? "text-success" : "text-warm"}`}>
                                  {card.source === "local" ? "本地菜谱" : "AI 建议"}
                                </Text>
                              </View>
                            </View>

                            {/* 第二行：营养数据独占一行胶囊 */}
                            <View className="bg-brand/10 px-2.5 py-1 rounded-xl border border-brand/20 mb-2.5 flex-row items-center gap-1.5 self-start">
                              <FontAwesome6 name="fire" size={10} colorClassName="accent-brand" />
                              <Text className="text-[10px] font-bold text-brand">
                                {card.macros}
                              </Text>
                            </View>

                            {/* 方案细节卡片内集成展示 */}
                            <View className="bg-canvas p-2.5 rounded-xl mb-3 border border-line gap-1.5">
                              <View className="flex-row items-start gap-1.5">
                                <FontAwesome6 name="carrot" size={10} colorClassName="accent-brand" className="mt-0.5" />
                                <Text className="text-[11px] font-medium text-ink flex-1 leading-relaxed">
                                  {card.ingredients}
                                </Text>
                              </View>
                              {card.cookingTip ? (
                                <View className="flex-row items-start gap-1.5 pt-1.5 border-t border-line/60">
                                  <FontAwesome6 name="fire-burner" size={10} colorClassName="accent-warm" className="mt-0.5" />
                                  <Text className="text-[10px] text-copy-muted flex-1 leading-relaxed">
                                    {card.cookingTip}
                                  </Text>
                                </View>
                              ) : null}
                            </View>

                            <TouchableOpacity
                              onPress={() => onStartCooking(card)}
                              className="bg-brand-fill py-2 rounded-xl items-center flex-row justify-center gap-1.5 shadow-2xs active:opacity-90"
                            >
                              <FontAwesome6 name="utensils" size={10} colorClassName="accent-on-brand" />
                              <Text className="text-xs font-bold text-white">选择【{card.schemeTag}】制作</Text>
                              <FontAwesome6 name="chevron-right" size={9} colorClassName="accent-on-brand" />
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={() => onSaveRecipe(msg.id, card)}
                              disabled={card.savedToRecipes}
                              className="mt-2 flex-row items-center justify-center gap-1.5 rounded-xl border border-brand/25 bg-brand/10 py-2 disabled:opacity-60"
                            >
                              <FontAwesome6 name={card.savedToRecipes ? "circle-check" : "bookmark"} size={10} colorClassName="accent-brand" />
                              <Text className="text-xs font-bold text-brand">{card.savedToRecipes ? "已保存到我的菜谱" : "保存到我的菜谱"}</Text>
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>

                  {msg.sender === "user" && (
                    <View className="w-9 h-9 rounded-full bg-brand-fill items-center justify-center ml-2.5 mt-0.5 shadow-xs overflow-hidden border border-white">
                      <Image
                        source={getAvatarSource(userAvatarUrl, userAvatarSeed)}
                        className="w-9 h-9 rounded-full"
                        resizeMode="cover"
                      />
                    </View>
                  )}

                  <Modal
                    visible={attachmentPreviewVisible && Boolean(attachmentUri)}
                    transparent
                    animationType="fade"
                    onRequestClose={() => setAttachmentPreviewVisible(false)}
                  >
                    <TouchableOpacity
                      activeOpacity={1}
                      onPress={() => setAttachmentPreviewVisible(false)}
                      className="flex-1 items-center justify-center bg-black/90 p-5"
                    >
                      {attachmentUri ? (
                        <Image source={{ uri: attachmentUri }} className="h-4/5 w-full" resizeMode="contain" />
                      ) : null}
                      <View className="absolute right-5 top-14 h-10 w-10 items-center justify-center rounded-full bg-white/15">
                        <FontAwesome6 name="xmark" size={18} colorClassName="accent-on-brand" />
                      </View>
                    </TouchableOpacity>
                  </Modal>

                  <Modal visible={editorVisible} transparent animationType="fade" onRequestClose={() => setEditorVisible(false)}>
                    <View className="flex-1 justify-center bg-black/45 px-5">
                      <View className="max-h-[80%] rounded-3xl bg-surface p-4">
                        <Text className="text-base font-black text-ink">编辑批准内容</Text>
                        <Text className="mt-1 text-[11px] leading-4 text-copy-muted">修改后会重新检查格式、权限、版本与安全限制。移除待批准项不会撤销已经执行的操作。</Text>
                        <ScrollView className="mt-3 max-h-96 rounded-2xl bg-canvas p-3">
                          {editedActions.map((action, index) => (
                            <View key={action.id || index} className="mb-4 gap-2 border-b border-line pb-3">
                              <Text className="text-sm font-bold text-ink">{action.summary}</Text>
                              <Text className="text-xs text-copy-muted">{getActionScopeDescription(action)} · 待批准</Text>
                              {isEditableAction(action) ? approvalFields(action).map((field) => (
                                <View key={field.key}>
                                  <Text className="text-xs text-copy-muted">{field.label}（原值：{String(agent?.run.pendingApproval?.actions.find((original) => original.id === action.id)?.payload[field.key] ?? "未填写")}）</Text>
                                  <TextInput accessibilityLabel={field.label} value={String(action.payload[field.key] ?? "")} keyboardType={field.numeric ? "decimal-pad" : "default"}
                                    onChangeText={(value) => setEditedActions((current) => current.map((item, position) => position === index ? editApprovalField(item, field, value) : item))}
                                    className="rounded-lg border border-line p-2 text-ink" />
                                </View>
                              )) : <Text className="text-xs text-copy-muted">此类操作暂不支持编辑，可保留或移除后重新提出请求。</Text>}
                              <TouchableOpacity accessibilityRole="button" onPress={() => setEditedActions((current) => current.filter((_, position) => position !== index))}>
                                <Text className="text-xs text-critical">移除此项</Text>
                              </TouchableOpacity>
                            </View>
                          ))}
                          {!editedActions.length ? <Text className="text-xs text-copy-muted">全部待批准项已移除，提交将拒绝这些操作。</Text> : null}
                        </ScrollView>
                        {editorError ? <Text className="mt-2 text-[10px] text-critical">{editorError}</Text> : null}
                        <View className="mt-4 flex-row gap-2">
                          <TouchableOpacity onPress={() => setEditorVisible(false)} className="flex-1 items-center rounded-xl border border-line py-3">
                            <Text className="text-xs font-bold text-copy-muted">取消</Text>
                          </TouchableOpacity>
                          <TouchableOpacity disabled={approvalBusy} onPress={() => void submitEditedApproval()} className="flex-1 items-center rounded-xl bg-brand-fill py-3">
                            <Text className="text-xs font-bold text-white">校验并批准</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  </Modal>
                </View>
  );
}
