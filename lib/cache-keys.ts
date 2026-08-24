/**
 * SWR cache keys — single source of truth shared by reads and mutations
 * so they can never drift apart.
 */
export const cacheKeys = {
  candidates: "/api/candidates",
  roles: "/api/roles",
} as const;
