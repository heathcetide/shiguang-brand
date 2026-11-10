import { createHash } from "node:crypto";
import type { DietRecordInput } from "./types.js";

export class DietRecordRequestError extends Error {
  readonly status:number;
  readonly code:string;
  constructor(status:number,code:string,message:string) {super(message);this.status=status;this.code=code;}
}
export function manualDietRequestIdentity(record:DietRecordInput) {
  const fields=Object.entries(record).filter(([key,value]) => key!=="idempotency_key" && value!==undefined)
    .sort(([left],[right]) => left<right ? -1 : left>right ? 1 : 0);
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}
export type ManualDietReceipt = {request_hash:string;diet_record_id:number|null;result_json:unknown};
export function replayManualDietRequest(receipt:ManualDietReceipt,requestHash:string):Record<string,unknown> {
  if(receipt.request_hash!==requestHash) throw new DietRecordRequestError(409,"DIET_RECORD_KEY_CONFLICT","此保存编号已用于另一条饮食记录，请恢复原内容重试或创建新记录");
  if(receipt.diet_record_id==null) throw new DietRecordRequestError(410,"DIET_RECORD_REQUEST_DELETED","这次保存的饮食记录已被删除，请新建记录后再保存");
  const record=(typeof receipt.result_json==="string" ? JSON.parse(receipt.result_json) : receipt.result_json) as Record<string,unknown>;
  return {...record,repeated:true};
}
