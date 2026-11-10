export const SERVER_VERSION = process.env.SERVER_VERSION?.trim() || "1.0.6";

// 构建产物由 build.js 注入该值；本地开发可通过环境变量覆盖。
export const SERVER_BUILD_TIME = process.env.SERVER_BUILD_TIME?.trim() || "开发模式";

// Only an explicitly supplied build identity can identify a deployed candidate.
export const SERVER_GIT_SHA = /^[a-f0-9]{40}$/.test(process.env.SERVER_GIT_SHA?.trim() || "")
  ? process.env.SERVER_GIT_SHA!.trim() : null;
