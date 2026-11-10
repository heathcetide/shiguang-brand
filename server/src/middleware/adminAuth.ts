import type { Response, NextFunction } from "express";
import type { AuthRequest } from "./auth.js";
import { accessControlService } from "../modules/accessControl/index.js";

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.userId) {
    return res.status(401).json({ error: "未登录，请先登录" });
  }

  void accessControlService().user(req.userId).then((user) => {
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: "无权限：需要管理员角色", code: "ADMIN_ROLE_REQUIRED" });
    }
    if (user.mustChangePassword) {
      return res.status(403).json({
        error: "首次登录必须修改管理员密码",
        code: "PASSWORD_CHANGE_REQUIRED",
      });
    }
    return next();
  }).catch((error) => {
    console.error("Admin Auth Error:", error);
    return res.status(500).json({ error: "服务器内部错误" });
  });
}
