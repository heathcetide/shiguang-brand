import { requestJson, publicFetch, type ApiFetch } from "./client";
import type { Recipe } from "./types";
import { Image } from "expo-image";

export const recipesApi = {
  list: <T = Recipe>(query = "") => requestJson<T[]>(publicFetch, `/api/v1/recipes${query}`),
  listPage: <T = Recipe>(query = "", apiFetch: ApiFetch = publicFetch) => requestJson<{ items: T[]; total?: number; nextCursor: string | null }>(apiFetch, `/api/v1/recipes${query}`),
  librarySummary: (apiFetch: ApiFetch = publicFetch) => requestJson<{
    official: number;
    community: number;
    personal: number;
    favorites: number;
    publicTotal: number;
    scopeContract: string;
    household: { supported: boolean; count: number };
  }>(apiFetch, "/api/v1/recipes/library-summary"),
  detail: (id: number) => requestJson<Recipe>(publicFetch, `/api/v1/recipes/${id}`),
  prefetchPage: (query = "") => requestJson<{ items: Recipe[]; total?: number; nextCursor: string | null }>(publicFetch, `/api/v1/recipes${query}`).then(() => undefined),
  prefetchDetail: (id: number) => requestJson<Recipe>(publicFetch, `/api/v1/recipes/${id}`).then((recipe) => {
    if (recipe.image_url) void Image.prefetch(recipe.image_url, { cachePolicy: "memory-disk" });
  }),
  prefetchCovers: (recipes: Array<Pick<Recipe, "image_url">>) => Promise.all(recipes
    .map((recipe) => recipe.image_url)
    .filter((url): url is string => Boolean(url))
    .slice(0, 12)
    .map((url) => Image.prefetch(url, { cachePolicy: "memory-disk" }).catch(() => false))),
  mine: <T = Recipe>(apiFetch: ApiFetch) => requestJson<T[]>(apiFetch, "/api/v1/recipes/mine"),
  favorites: (apiFetch: ApiFetch) => requestJson<Recipe[]>(apiFetch, "/api/v1/recipes/favorites"),
  favoriteCount: (apiFetch: ApiFetch) => requestJson<{ count: number }>(apiFetch, "/api/v1/recipes/favorites/count"),
  favorite: (apiFetch: ApiFetch, id: number) => requestJson<{ is_favorited: boolean }>(apiFetch, `/api/v1/recipes/${id}/favorite`, { method: "POST" }),
  unfavorite: (apiFetch: ApiFetch, id: number) => requestJson<{ is_favorited: boolean }>(apiFetch, `/api/v1/recipes/${id}/favorite`, { method: "DELETE" }),
  favoriteState: (apiFetch: ApiFetch, id: number) => requestJson<{ is_favorited: boolean }>(apiFetch, `/api/v1/recipes/${id}/favorite`),
  submit: (apiFetch: ApiFetch, input: unknown, id?: number) => requestJson<{ id: number; message: string }>(apiFetch, id ? `/api/v1/recipes/submissions/${id}` : "/api/v1/recipes/submissions", {
    method: id ? "PUT" : "POST", body: JSON.stringify(input),
  }),
  withdraw: (apiFetch: ApiFetch, id: number) => requestJson<{ message: string }>(apiFetch, `/api/v1/recipes/submissions/${id}`, { method: "DELETE" }),
};
