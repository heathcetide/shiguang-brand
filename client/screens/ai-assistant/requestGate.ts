// React state updates do not serialize two callbacks in the same render.
// An old account's completion must not release a new account's request.
export function createRequestGate() {
  let active: { scope: string } | undefined;
  return {
    acquire(scope: string) {
      if (active?.scope === scope) return null;
      const request = { scope };
      active = request;
      return () => { if (active === request) active = undefined; };
    },
  };
}
