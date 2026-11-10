import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Router, type NextFunction, type Response as ExpressResponse } from "express";
import { Reader, type Response as GeoResponse } from "maxmind";
import { authMiddleware, optionalAuthMiddleware, type AuthRequest } from "../../middleware/auth.js";
import { getRateLimitClientIp, sharedRateLimit } from "../../middleware/sharedRateLimit.js";
import { validateBody } from "../../middleware/validate.js";
import { positiveIntegerParam } from "../../middleware/validateParam.js";
import { currentDateKey } from "../../utils/date.js";
import { sendError } from "../../utils/http.js";
import { communityCommentSchema, communityPostSchema } from "../../validation/schemas.js";
import { CommunityError } from "./errors.js";
import type { CommunityService } from "./service.js";
import type { AuthUser, Row } from "./types.js";

const shareRateLimit = sharedRateLimit({
  namespace: "community-share-ip",
  limit: Math.max(1, Number(process.env.COMMUNITY_SHARE_RATE_LIMIT) || 20),
  windowMs: Math.max(1_000, Number(process.env.COMMUNITY_SHARE_RATE_LIMIT_WINDOW_MS) || 60 * 60 * 1000),
  key: getRateLimitClientIp,
  message: "分享请求过于频繁，请稍后重试",
  code: "COMMUNITY_SHARE_RATE_LIMITED",
});

const countryNames = new Intl.DisplayNames(["zh-CN"], { type: "region" });
type CountryLookup = GeoResponse & {
  country_code?: string;
  country?: { iso_code?: string };
  city?: { names?: Record<string, string> };
};

let geoIpReader: Reader<CountryLookup> | null = null;
const require = createRequire(import.meta.url);
try {
  const databasePath = process.env.GEOIP_DATABASE_PATH?.trim()
    || require.resolve("@ip-location-db/geolite2-country-mmdb/geolite2-country.mmdb");
  geoIpReader = new Reader<CountryLookup>(readFileSync(databasePath));
} catch (error) {
  console.warn("GeoIP database unavailable", error);
}

function requestLocation(req: AuthRequest) {
  if (process.env.TRUST_GEO_HEADERS === "1") {
    const region = String(req.get("cf-ipcountry") || req.get("x-vercel-ip-country") || "").trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(region) && region !== "XX" && region !== "T1") return countryNames.of(region) || region;
  }
  const ip = String(req.ip || req.socket.remoteAddress || "").replace(/^::ffff:/, "");
  if (/^(::1|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) return "本地网络";
  const lookup = geoIpReader?.get(ip);
  const countryCode = lookup?.country_code || lookup?.country?.iso_code;
  if (!countryCode) return null;
  const country = countryNames.of(countryCode) || countryCode;
  const city = lookup.city?.names?.["zh-CN"] || lookup.city?.names?.en;
  return city ? `${country} · ${city}` : country;
}

function known(error: unknown, res: ExpressResponse) {
  if (!(error instanceof CommunityError)) return false;
  if (error.code) sendError(res, error.status, error.message, error.code);
  else res.status(error.status).json({ error: error.message });
  return true;
}

function handle(error: unknown, res: ExpressResponse, next: NextFunction) {
  if (!known(error, res)) next(error);
}

async function authenticated(service: CommunityService, req: AuthRequest, res: ExpressResponse) {
  const user = await service.authUser(req.userId);
  if (!user) res.status(401).json({ error: "未登录" });
  return user;
}

export function createCommunityRouter(service: CommunityService) {
  const router = Router();
  router.param("id", positiveIntegerParam);
  router.param("postId", positiveIntegerParam);
  router.param("commentId", positiveIntegerParam);
  router.param("userId", positiveIntegerParam);
  router.use(optionalAuthMiddleware);

  router.get("/users", (req: AuthRequest, res, next) => {
    void service.searchUsers(req.userId ?? null, req.query.query).then((users) => res.json(users)).catch(next);
  });

  router.get("/following", authMiddleware, async (req: AuthRequest, res, next) => {
    try { const user = await authenticated(service, req, res); if (user) res.json(await service.following(user.id)); }
    catch (error) { handle(error, res, next); }
  });

  router.get("/level", authMiddleware, async (req: AuthRequest, res, next) => {
    try { const user = await authenticated(service, req, res); if (user) res.json(await service.level(user.id)); }
    catch (error) { handle(error, res, next); }
  });

  router.get("/check-in", authMiddleware, async (req: AuthRequest, res, next) => {
    try { const user = await authenticated(service, req, res); if (user) res.json(await service.checkInStatus(user.id, currentDateKey())); }
    catch (error) { handle(error, res, next); }
  });

  router.post("/check-in", authMiddleware, async (req: AuthRequest, res, next) => {
    try { const user = await authenticated(service, req, res); if (user) { const result = await service.checkIn(user.id, currentDateKey()); res.status(result.status).json(result.body); } }
    catch (error) { handle(error, res, next); }
  });

  router.post("/users/:userId/follow", authMiddleware, async (req: AuthRequest, res, next) => {
    try { const user = await authenticated(service, req, res); if (user) res.json(await service.toggleFollow(user.id, Number(req.params.userId))); }
    catch (error) { handle(error, res, next); }
  });

  router.get("/users/:userId/profile", (req: AuthRequest, res, next) => {
    void service.profile(req.userId ?? null, Number(req.params.userId)).then((profile) => res.json(profile)).catch((error) => handle(error, res, next));
  });

  router.get("/posts", (req: AuthRequest, res, next) => {
    void service.posts(req.userId ?? null, req.query as Row).then((result) => {
      res.set("X-Pagination-Candidates", String(result.candidates));
      res.json(result.body);
    }).catch((error) => handle(error, res, next));
  });

  router.get("/posts/:id", (req: AuthRequest, res, next) => {
    void service.post(req.userId ?? null, Number(req.params.id)).then((post) => res.json(post)).catch((error) => handle(error, res, next));
  });

  router.post("/posts/:id/share", shareRateLimit, (req: AuthRequest, res, next) => {
    const baseUrl = String(process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get("host")}`);
    void service.share(Number(req.params.id), req.userId ?? null, baseUrl).then((result) => res.status(result.status).json(result.body))
      .catch((error) => handle(error, res, next));
  });

  router.get("/shares/:code", (req, res, next) => {
    void service.resolveShare(req.params.code).then((share) => res.json(share)).catch((error) => handle(error, res, next));
  });

  router.post("/posts", authMiddleware, validateBody(communityPostSchema), async (req: AuthRequest, res, next) => {
    try {
      const user = await authenticated(service, req, res);
      if (user) res.status(201).json(await service.createPost(user as AuthUser, req.body, requestLocation(req)));
    } catch (error) { handle(error, res, next); }
  });

  router.post("/posts/:id/join", authMiddleware, async (req: AuthRequest, res, next) => {
    try { const user = await authenticated(service, req, res); if (user) res.json(await service.toggleJoin(user.id, Number(req.params.id))); }
    catch (error) { handle(error, res, next); }
  });

  for (const method of ["put", "delete"] as const) {
    router[method]("/posts/:id/bookmark", authMiddleware, async (req: AuthRequest, res, next) => {
      try {
        const user = await authenticated(service, req, res);
        if (user) res.json(await service.setPostBookmark(user.id, Number(req.params.id), method === "put"));
      } catch (error) { handle(error, res, next); }
    });
  }

  router.post("/posts/:id/like", authMiddleware, async (req: AuthRequest, res, next) => {
    try { const user = await authenticated(service, req, res); if (user) res.json(await service.togglePostLike(user.id, Number(req.params.id))); }
    catch (error) { handle(error, res, next); }
  });

  router.get("/posts/:id/comments", (req: AuthRequest, res, next) => {
    void service.comments(req.userId ?? null, Number(req.params.id)).then((comments) => res.json(comments)).catch(next);
  });

  router.post("/posts/:id/comments", authMiddleware, validateBody(communityCommentSchema), async (req: AuthRequest, res, next) => {
    try {
      const user = await authenticated(service, req, res);
      if (user) res.status(201).json(await service.createComment(user as AuthUser, Number(req.params.id), req.body));
    } catch (error) { handle(error, res, next); }
  });

  router.post("/posts/:postId/comments/:commentId/accept", authMiddleware, async (req: AuthRequest, res, next) => {
    try { const user = await authenticated(service, req, res); if (user) res.json(await service.acceptComment(user.id, Number(req.params.postId), Number(req.params.commentId))); }
    catch (error) { handle(error, res, next); }
  });

  router.post("/comments/:id/like", authMiddleware, async (req: AuthRequest, res, next) => {
    try { const user = await authenticated(service, req, res); if (user) res.json(await service.toggleCommentLike(user.id, Number(req.params.id))); }
    catch (error) { handle(error, res, next); }
  });

  return router;
}
