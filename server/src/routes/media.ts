import { Router } from "express";

import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { sharedRateLimit } from "../middleware/sharedRateLimit.js";
import { validateBody } from "../middleware/validate.js";
import { mediaImageUploadSchema } from "../validation/schemas.js";
import { InvalidMediaError, MediaStorageUnavailableError, uploadImageDataUrl } from "../services/mediaStorage.js";

const router = Router();
router.use(authMiddleware);
router.use(sharedRateLimit({
  namespace: "media-user",
  limit: Math.max(1, Number(process.env.MEDIA_UPLOAD_RATE_LIMIT) || 30),
  windowMs: 15 * 60 * 1000,
  key: (req) => String((req as AuthRequest).userId || "unknown"),
  message: "图片上传过于频繁，请稍后重试",
  code: "MEDIA_RATE_LIMITED",
}));

router.post("/images", validateBody(mediaImageUploadSchema), async (req: AuthRequest, res) => {
  try {
    const result = await uploadImageDataUrl(req.body.data_url, req.userId!, req.body.scope);
    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof InvalidMediaError) return res.status(400).json({ error: error.message, code: "INVALID_MEDIA" });
    if (error instanceof MediaStorageUnavailableError) return res.status(503).json({ error: error.message, code: "MEDIA_STORAGE_UNAVAILABLE" });
    console.error("[Media Upload Error]", error);
    return res.status(502).json({ error: "图片暂时无法上传", code: "MEDIA_UPLOAD_FAILED" });
  }
});

export default router;
