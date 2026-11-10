import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

let configuredCheckpointer: BaseCheckpointSaver | undefined;

export function configureAgentCheckpointer(checkpointer: BaseCheckpointSaver) {
  if (configuredCheckpointer && configuredCheckpointer !== checkpointer) {
    throw new Error("Agent checkpointer 已配置，不能在运行时切换数据库");
  }
  configuredCheckpointer = checkpointer;
}

export function agentCheckpointer() {
  if (!configuredCheckpointer) throw new Error("Agent checkpointer 尚未初始化");
  return configuredCheckpointer;
}
