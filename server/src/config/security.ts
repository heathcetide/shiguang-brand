import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const configuredSecret = process.env.JWT_SECRET?.trim();

if (process.env.NODE_ENV === "production" && (!configuredSecret || configuredSecret.length < 32)) {
  throw new Error("生产环境必须设置长度至少为 32 个字符的 JWT_SECRET");
}

function getOrGenerateDevSecret(): string {
  if (configuredSecret && configuredSecret.length >= 32) {
    return configuredSecret;
  }

  const dataDir = path.resolve(process.cwd(), "data");
  const secretFilePath = path.join(dataDir, "jwt_secret.key");

  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    if (fs.existsSync(secretFilePath)) {
      const savedSecret = fs.readFileSync(secretFilePath, "utf-8").trim();
      if (savedSecret && savedSecret.length >= 32) {
        return savedSecret;
      }
    }
    const newSecret = crypto.randomBytes(48).toString("base64url");
    fs.writeFileSync(secretFilePath, newSecret, "utf-8");
    return newSecret;
  } catch (err) {
    return configuredSecret || "dietdigidose_persistent_dev_jwt_secret_key_32bytes_min";
  }
}

export const JWT_SECRET = getOrGenerateDevSecret();
