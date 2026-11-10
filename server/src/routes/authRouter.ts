import type { Router as ExpressRouter } from "express";

export function createAuthRouter(accountRoutes: ExpressRouter) {
  return accountRoutes;
}
