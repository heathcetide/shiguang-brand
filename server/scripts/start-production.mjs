process.env.NODE_ENV ||= "production";
process.env.PORT ||= "9090";

await import("../dist/index.js");
