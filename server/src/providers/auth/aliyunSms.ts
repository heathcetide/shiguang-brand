import Dypnsapi20170525Package, {
  CheckSmsVerifyCodeRequest,
  SendSmsVerifyCodeRequest,
} from "@alicloud/dypnsapi20170525";
import { $OpenApiUtil } from "@alicloud/openapi-core";
import { RuntimeOptions } from "@darabonba/typescript";

import type { SmsProvider, SmsSendResult, SmsServiceConfig, SmsVerifyResult } from "../contracts.js";

const Dypnsapi20170525 = (
  (Dypnsapi20170525Package as unknown as { default?: typeof Dypnsapi20170525Package }).default
  || Dypnsapi20170525Package
) as typeof Dypnsapi20170525Package;

function providerRuntimeOptions() {
  return new RuntimeOptions({ autoretry: false, maxAttempts: 1, connectTimeout: 5_000, readTimeout: 10_000 });
}

export class AliyunSmsProvider implements SmsProvider {
  readonly id = "aliyun-pnvs";

  private client() {
    const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID?.trim();
    const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET?.trim();
    if (!accessKeyId || !accessKeySecret) throw new Error("ALIYUN_SMS_CREDENTIALS_MISSING");
    return new Dypnsapi20170525(new $OpenApiUtil.Config({
      accessKeyId,
      accessKeySecret,
      endpoint: process.env.ALIYUN_DYPNS_ENDPOINT?.trim() || "dypnsapi.aliyuncs.com",
      regionId: process.env.ALIYUN_REGION_ID?.trim() || "cn-hangzhou",
    }));
  }

  async send(phone: string, outId: string, config: SmsServiceConfig): Promise<SmsSendResult> {
    const response = await this.client().sendSmsVerifyCodeWithOptions(new SendSmsVerifyCodeRequest({
      phoneNumber: phone,
      countryCode: "86",
      signName: config.signName,
      templateCode: config.templateCode,
      templateParam: JSON.stringify({ code: "##code##", min: "5" }),
      codeLength: 6,
      codeType: 1,
      validTime: 300,
      interval: 60,
      duplicatePolicy: 1,
      autoRetry: 1,
      returnVerifyCode: false,
      outId,
    }), providerRuntimeOptions());
    const body = response.body;
    return {
      success: body?.success === true && body.code === "OK",
      code: body?.code || "UNKNOWN",
      message: body?.message || "",
      requestId: body?.requestId || body?.model?.requestId || null,
      bizId: body?.model?.bizId || null,
      outId: body?.model?.outId || outId,
    };
  }

  async verify(phone: string, outId: string, code: string): Promise<SmsVerifyResult> {
    const response = await this.client().checkSmsVerifyCodeWithOptions(new CheckSmsVerifyCodeRequest({
      phoneNumber: phone,
      countryCode: "86",
      outId,
      verifyCode: code,
      caseAuthPolicy: 2,
    }), providerRuntimeOptions());
    const body = response.body;
    return {
      success: body?.success === true && body.code === "OK",
      passed: body?.model?.verifyResult === "PASS",
      code: body?.code || "UNKNOWN",
      message: body?.message || "",
      outId: body?.model?.outId || outId,
    };
  }
}
