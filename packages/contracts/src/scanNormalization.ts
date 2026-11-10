const recognized = (present: boolean) => ({ status: present ? "estimated" as const : "unknown" as const,
  source: present ? "recognition" as const : "unknown" as const });

export function normalizeInventoryScanItems(items: unknown) {
  return (Array.isArray(items) ? items : [])
    .filter((item: { foodName?: unknown }) => item != null && typeof item.foodName === "string" && item.foodName.trim())
    .slice(0, 30)
    .map((item: { foodName: string; quantity?: string; suggestedStorageLocation?: string; estimatedExpireDays?: number; confidence?: number }) => {
      const quantity = typeof item.quantity === "string" ? item.quantity.trim() : "";
      const suggestedStorageLocation = ["冷藏", "冷冻", "常温"].includes(item.suggestedStorageLocation || "") ? item.suggestedStorageLocation! : "";
      const estimatedExpireDays = typeof item.estimatedExpireDays === "number" && Number.isInteger(item.estimatedExpireDays) && item.estimatedExpireDays >= 1 && item.estimatedExpireDays <= 365 ? item.estimatedExpireDays : null;
      return {
        fieldEvidence: {
          food_name: recognized(true),
          quantity: recognized(!!quantity),
          storage_location: recognized(!!suggestedStorageLocation),
          expiration_date: recognized(estimatedExpireDays !== null),
        },
        foodName: item.foodName.trim(),
        quantity,
        suggestedStorageLocation,
        estimatedExpireDays,
        confidence: typeof item.confidence === "number" && Number.isFinite(item.confidence) && item.confidence >= 0 && item.confidence <= 1 ? item.confidence : null,
        missingFields: [
          ...(!quantity ? ["数量"] : []),
          ...(!suggestedStorageLocation ? ["存放位置"] : []),
          ...(estimatedExpireDays === null ? ["保质期"] : []),
        ],
      };
    });
}
