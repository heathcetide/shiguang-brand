import crypto from "node:crypto";
import { Router } from "express";
import { authVerificationService } from "../modules/authVerification/runtime.js";
import { currentDateKey } from "../utils/date.js";

const router = Router();

function validCallbackToken(received: string) {
  const expected = process.env.ALIYUN_SMS_CALLBACK_TOKEN?.trim() || "";
  if (!expected) return false;
  const receivedBytes = new TextEncoder().encode(received);
  const expectedBytes = new TextEncoder().encode(expected);
  if (receivedBytes.byteLength !== expectedBytes.byteLength) return false;
  return crypto.timingSafeEqual(new DataView(receivedBytes.buffer), new DataView(expectedBytes.buffer));
}

router.post("/aliyun/sms-delivery/:token", async (req, res) => {
  try {
    if (!validCallbackToken(req.params.token)) return res.status(404).json({ code: 404, msg: "Not found" });
    if (!Array.isArray(req.body)) return res.status(400).json({ code: 400, msg: "Invalid payload" });
    for (const report of req.body.slice(0, 1000)) {
        const bizId = typeof report?.biz_id === "string" ? report.biz_id.trim() : "";
        const outId = typeof report?.out_id === "string" ? report.out_id.trim() : "";
        const providerCode = typeof report?.err_code === "string" ? report.err_code.trim() : "";
        const providerMessage = typeof report?.err_msg === "string" ? report.err_msg : "";
        const success = report?.success === true;
        const units = Math.max(1, Math.min(100, Number.parseInt(String(report?.sms_size || "1"), 10) || 1));
        if (!bizId && !outId) continue;
        await authVerificationService().recordDeliveryReport({
          bizId,
          outId,
          providerCode,
          providerMessage,
          success,
          units,
          usageDate: currentDateKey(),
          details: {
            sendTime: typeof report?.send_time === "string" ? report.send_time : null,
            reportTime: typeof report?.report_time === "string" ? report.report_time : null,
            smsSize: units,
          },
        });
      }
    return res.json({ code: 0, msg: "接收成功" });
  } catch (error) {
    console.error("[Aliyun SMS Callback Error]", error instanceof Error ? error.name : "UnknownError");
    return res.status(503).json({ code: 503, msg: "处理失败" });
  }
});

export default router;
