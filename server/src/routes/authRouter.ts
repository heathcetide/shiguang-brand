import { Router, type Router as ExpressRouter } from "express";
import smsAuthRoutes, { reauthRouter, passwordRecoveryRouter, phoneBindingRouter } from "./auth-sms.js";

export function createAuthRouter(accountRoutes: ExpressRouter) {
  const router = Router();
  router.use("/phone-binding", phoneBindingRouter);
  router.use("/sms", smsAuthRoutes);
  router.use("/reauth/sms", reauthRouter);
  router.use("/password-recovery", passwordRecoveryRouter);
  router.use(accountRoutes);
  return router;
}
