/** One retry key per account, meal and version. Only confirmed success retires it. */
export function createShoppingRequestKeys() {
  const pending = new Map<string,string>();
  let serial = 0;
  const session = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return {
    get(account: string, itemId: string, version: number) {
      const scope = JSON.stringify([account,itemId,version]);
      let key = pending.get(scope);
      if (!key) { key = `meal-shopping:${session}:${++serial}`; pending.set(scope,key); }
      return key;
    },
    complete(account: string, itemId: string, version: number, key: string) {
      const scope = JSON.stringify([account,itemId,version]);
      if (pending.get(scope) === key) pending.delete(scope);
    },
  };
}

export function personalShoppingMessage(result: { added: number; coverage?: "covered" | "shortfall" | "needs_review"; reviewItems?: Array<{ name: string; reason: string }> }) {
  const summary = result.coverage === "covered" ? "本餐单库存核算覆盖本餐需求" : result.added ? `已加入 ${result.added} 个缺失食材` : "本次未新增采购项";
  const review = result.reviewItems?.map(entry => `${entry.name}：${entry.reason}`).join("\n");
  return `${summary}${review ? `\n${review}` : ""}\n仅核算本餐单，未预留库存或抵扣其他餐单需求。`;
}
