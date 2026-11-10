import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";

export function createSqliteAgentCheckpointer(database: ConstructorParameters<typeof SqliteSaver>[0]) {
  return new SqliteSaver(database);
}
