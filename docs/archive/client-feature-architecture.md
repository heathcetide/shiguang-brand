# Client feature architecture

Screens are route-level composition roots. They may own navigation, native permissions, and layout composition, but they should not implement HTTP, cache, retry, pagination, or cross-screen server-state rules inline.

The inventory pilot uses these boundaries:

```text
app route → screen composition → feature components
                         └──────→ query/mutation hooks → services/api → shared contracts
```

- `client/app/**` contains Expo Router configuration and one-line screen exports only.
- `client/screens/<feature>/index.tsx` composes sections and owns transient presentation state such as the selected segment or open modal.
- Feature components receive render-ready values and callbacks. They do not call APIs or invalidate caches.
- `useInventoryData.ts` owns server reads, pagination, loading/error states, and user-scoped offline snapshots through TanStack Query.
- `useInventoryMutations.ts` owns writes and calls the shared invalidation policy in `queryKeys.ts` after success.
- `client/services/api/**` owns endpoint paths, transport, and shared-contract parsing. It contains no screen state.
- `@dietdigidose/contracts` remains the authority for request and response validation.

## Cache rules

Every key includes the authenticated user when data is private. Inventory mutations invalidate only that user's personal inventory; kitchenware mutations invalidate only that user's kitchenware; recipe-library mutations invalidate the summary and all recipe catalog variants. Logout changes the key namespace, so cached private data is never rendered for another account.

Offline snapshots are an explicit fallback inside the query function. A successful response replaces the snapshot. A cached fallback is labeled as offline; a missing snapshot produces the normal section error without hiding unrelated sections.

New server-backed screens must define query keys and mutation invalidation tests before adding component-level fetch effects. Use local React state for drafts, animations, native permission prompts, and modal visibility—not for a second copy of remote loading/error state.
