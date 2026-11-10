import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState, type SetStateAction } from "react";

import { inventoryApi, kitchenwareApi, recipesApi } from "@/services/api";
import type { ApiFetch } from "@/services/api/client";
import { appendUniqueItemsByKey } from "@/utils/pagination";
import { ApiError } from "@/services/api/client";
import { beginInventorySnapshot, readInventorySnapshot, saveInventorySnapshot } from "@/services/offlineInventory";
import { inventoryQueryKeys } from "./queryKeys";
import type { InventoryItem, KitchenwareCatalogItem, KitchenwareItem, Recipe } from "./types";

type InventorySection = "inventory" | "recipes" | "kitchenware";
type CachedResult<T> = { value: T; offlineMessage?: string };
type RecipePage = { items: Recipe[]; total?: number; nextCursor: string | null; offlineMessage?: string };

const RECIPE_PAGE_SIZE = 24;

export interface RecipeCatalogQuery {
  category?: string;
  search?: string;
  maxCookTime?: number;
  scope?: "official" | "personal";
}

function normalizeRecipeQuery(query: RecipeCatalogQuery): RecipeCatalogQuery {
  return {
    category: query.category?.trim() || undefined,
    search: query.search?.trim() || undefined,
    maxCookTime: query.maxCookTime && query.maxCookTime > 0 ? query.maxCookTime : undefined,
    scope: query.scope,
  };
}

export function buildRecipePageQuery(query: RecipeCatalogQuery, cursor?: string | null) {
  const params = new URLSearchParams({ pageSize: String(RECIPE_PAGE_SIZE) });
  if (query.category) params.set("category", query.category);
  if (query.search) params.set("search", query.search);
  if (query.maxCookTime) params.set("maxCookTime", String(query.maxCookTime));
  if (query.scope) params.set("scope", query.scope);
  if (cursor) params.set("cursor", cursor);
  return `?${params.toString()}`;
}

function sameRecipeQuery(left: RecipeCatalogQuery, right: RecipeCatalogQuery) {
  return left.category === right.category
    && left.search === right.search
    && left.maxCookTime === right.maxCookTime
    && left.scope === right.scope;
}

export function useInventoryData(authFetch: ApiFetch, isAuthenticated: boolean, userId?: number | null) {
  const queryClient = useQueryClient();
  const personalInventoryKey = useMemo(() => inventoryQueryKeys.personal(userId), [userId]);
  const [recipeQuery, setRecipeQuery] = useState<RecipeCatalogQuery>({});

  const inventoryQuery = useQuery({
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    queryKey: personalInventoryKey,
    enabled: isAuthenticated,
    queryFn: async (): Promise<CachedResult<InventoryItem[]>> => {
      const ticket = beginInventorySnapshot(userId);
      try {
        const value = await inventoryApi.list(authFetch, true);
        // A storage failure must not replace a successful network result.
        await saveInventorySnapshot(ticket, value).catch(() => undefined);
        return { value };
      } catch (error) {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) throw error;
        const cached = await readInventorySnapshot(ticket).catch(() => null);
        if (!cached) throw error;
        return {
          value: cached,
          offlineMessage: "离线模式 · 已载入本地食材快照",
        };
      }
    },
  });

  const recipesQuery = useInfiniteQuery({
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    queryKey: inventoryQueryKeys.recipeCatalog(isAuthenticated ? userId : null, recipeQuery),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<RecipePage> => {
      const page = await recipesApi.listPage<Recipe>(
        buildRecipePageQuery(recipeQuery, pageParam),
        isAuthenticated ? authFetch : undefined,
      );
      return { ...page, items: Array.isArray(page.items) ? page.items : [] };
    },
    getNextPageParam: (page) => page.nextCursor || undefined,
  });

  const kitchenwareQuery = useQuery({
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    queryKey: inventoryQueryKeys.kitchenware(userId),
    enabled: isAuthenticated,
    queryFn: () => kitchenwareApi.list<KitchenwareItem>(authFetch),
  });
  const kitchenwareCatalogQuery = useQuery({
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    queryKey: inventoryQueryKeys.kitchenwareCatalog,
    enabled: isAuthenticated,
    queryFn: () => kitchenwareApi.catalog<KitchenwareCatalogItem>(authFetch),
  });
  const recipeLibrarySummaryQuery = useQuery({
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    queryKey: inventoryQueryKeys.recipeLibrarySummary(userId),
    enabled: isAuthenticated,
    queryFn: () => recipesApi.librarySummary(authFetch),
  });

  const items = inventoryQuery.data?.value ?? [];
  const setItems = useCallback((next: SetStateAction<InventoryItem[]>) => {
    queryClient.setQueryData<CachedResult<InventoryItem[]>>(personalInventoryKey, (current) => {
      const previous = current?.value ?? [];
      return { value: typeof next === "function" ? next(previous) : next };
    });
  }, [personalInventoryKey, queryClient]);

  const recipes = useMemo(() => recipesQuery.data?.pages.reduce<Recipe[]>(
    (all, page) => appendUniqueItemsByKey(all, page.items, (recipe) => recipe.id),
    [],
  ) ?? [], [recipesQuery.data]);
  const firstRecipePage = recipesQuery.data?.pages[0];
  const recipeTotal = Number.isFinite(Number(firstRecipePage?.total))
    ? Math.max(0, Number(firstRecipePage?.total))
    : recipes.length;

  const refetchRecipes = recipesQuery.refetch;
  const fetchNextRecipePage = recipesQuery.fetchNextPage;
  const refetchInventory = inventoryQuery.refetch;
  const refetchKitchenware = kitchenwareQuery.refetch;
  const refetchKitchenwareCatalog = kitchenwareCatalogQuery.refetch;
  const refetchRecipeLibrarySummary = recipeLibrarySummaryQuery.refetch;
  const reloadRecipes = useCallback(async (next: RecipeCatalogQuery = recipeQuery) => {
    const normalized = normalizeRecipeQuery(next);
    if (sameRecipeQuery(normalized, recipeQuery)) await refetchRecipes();
    else setRecipeQuery(normalized);
  }, [recipeQuery, refetchRecipes]);

  const loadMoreRecipes = useCallback(async () => {
    if (recipesQuery.hasNextPage && !recipesQuery.isFetchingNextPage) await fetchNextRecipePage();
  }, [fetchNextRecipePage, recipesQuery.hasNextPage, recipesQuery.isFetchingNextPage]);

  const refresh = useCallback(async () => {
    const operations: Array<Promise<unknown>> = [refetchRecipes()];
    if (isAuthenticated) operations.push(
      refetchInventory(),
      refetchKitchenware(),
      refetchKitchenwareCatalog(),
      refetchRecipeLibrarySummary(),
    );
    await Promise.allSettled(operations);
  }, [
    isAuthenticated,
    refetchInventory,
    refetchKitchenware,
    refetchKitchenwareCatalog,
    refetchRecipeLibrarySummary,
    refetchRecipes,
  ]);

  const sectionErrors: Partial<Record<InventorySection, string>> = {};
  if (inventoryQuery.data?.offlineMessage) sectionErrors.inventory = inventoryQuery.data.offlineMessage;
  else if (inventoryQuery.isError) sectionErrors.inventory = "库存暂时无法加载，菜谱与厨具仍可使用";
  const offlineRecipePage = recipesQuery.data?.pages.find((page) => page.offlineMessage);
  if (offlineRecipePage?.offlineMessage) sectionErrors.recipes = offlineRecipePage.offlineMessage;
  else if (recipesQuery.isFetchNextPageError) sectionErrors.recipes = "后续菜谱加载失败，点击可重试";
  else if (recipesQuery.isError) sectionErrors.recipes = "菜谱暂时无法加载，库存功能仍可使用";
  if (kitchenwareQuery.isError || kitchenwareCatalogQuery.isError) {
    sectionErrors.kitchenware = "部分厨具数据暂时无法加载，其他功能仍可使用";
  }

  return {
    items,
    setItems,
    recipes,
    recipeTotal,
    recipeLibrarySummary: recipeLibrarySummaryQuery.data ?? { official: 0, community: 0, personal: 0, favorites: 0 },
    hasMoreRecipes: Boolean(recipesQuery.hasNextPage),
    kitchenware: kitchenwareQuery.data ?? [],
    kitchenwareCatalog: kitchenwareCatalogQuery.data ?? [],
    loadingItems: inventoryQuery.isLoading,
    loadingRecipes: recipesQuery.isLoading,
    loadingMoreRecipes: recipesQuery.isFetchingNextPage,
    loadingKitchenware: kitchenwareQuery.isLoading || kitchenwareCatalogQuery.isLoading,
    sectionErrors,
    refresh,
    reloadRecipes,
    loadMoreRecipes,
  };
}
