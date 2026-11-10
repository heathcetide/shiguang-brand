/** Explicit deployment identity; NODE_ENV cannot distinguish staging from production. */
export function coreLoopEnvironment(): string | null {
  const value = process.env.CORE_LOOP_ENVIRONMENT?.trim();
  return value && value !== "unknown" && /^[a-z][a-z0-9_-]{0,39}$/.test(value) ? value : null;
}
