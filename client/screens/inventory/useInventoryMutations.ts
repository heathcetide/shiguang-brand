import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { InventoryBulkIntakeInput, InventoryCreateInput, InventoryUpdateInput } from "@dietdigidose/contracts";

import { inventoryApi, kitchenwareApi } from "@/services/api";
import type { ApiFetch } from "@/services/api/client";
import { invalidateInventoryServerState } from "./queryKeys";

export function useInventoryMutations(authFetch: ApiFetch, userId?: number | null) {
  const queryClient = useQueryClient();
  const invalidateInventory = () => invalidateInventoryServerState(queryClient, "inventory", userId);
  const invalidateKitchenware = () => invalidateInventoryServerState(queryClient, "kitchenware", userId);

  return {
    acceptScan: useMutation({
      mutationFn: (jobId: string) => inventoryApi.acceptScan(authFetch, jobId),
      onSuccess: invalidateInventory,
    }),
    undoScan: useMutation({
      mutationFn: (jobId: string) => inventoryApi.undoScan(authFetch, jobId),
      onSuccess: invalidateInventory,
    }),
    createInventory: useMutation({
      mutationFn: (input: InventoryCreateInput) => inventoryApi.create(authFetch, input),
      onSuccess: invalidateInventory,
    }),
    updateInventory: useMutation({
      mutationFn: ({ id, input }: { id: number; input: InventoryUpdateInput }) => inventoryApi.update(authFetch, id, input),
      onSuccess: invalidateInventory,
    }),
    removeInventory: useMutation({
      mutationFn: (id: number) => inventoryApi.remove(authFetch, id),
      onSuccess: invalidateInventory,
    }),
    bulkIntake: useMutation({
      mutationFn: (input: InventoryBulkIntakeInput) => inventoryApi.bulkIntake(authFetch, input),
      onSuccess: invalidateInventory,
    }),
    createKitchenware: useMutation({
      mutationFn: (input: unknown) => kitchenwareApi.create(authFetch, input),
      onSuccess: invalidateKitchenware,
    }),
    updateKitchenware: useMutation({
      mutationFn: ({ id, input }: { id: number; input: unknown }) => kitchenwareApi.update(authFetch, id, input),
      onSuccess: invalidateKitchenware,
    }),
    maintainKitchenware: useMutation({
      mutationFn: (id: number) => kitchenwareApi.maintain(authFetch, id),
      onSuccess: invalidateKitchenware,
    }),
    removeKitchenware: useMutation({
      mutationFn: (id: number) => kitchenwareApi.remove(authFetch, id),
      onSuccess: invalidateKitchenware,
    }),
  };
}
