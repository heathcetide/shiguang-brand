import { randomUUID } from "node:crypto";
import { describeStoredMediaUrls, type StoredMediaReference } from "../../services/mediaStorage.js";
import type { MediaCleanupRepository } from "./repository.js";
import type { MediaCleanupFilter, MediaCleanupJob, MediaCleanupJobRow } from "./types.js";

export const MEDIA_CLEANUP_STALE_MINUTES=30;
export function sanitizeMediaCleanupError(error:unknown){return (error instanceof Error?error.message:String(error))
  .replace(/https?:\/\/[^\s"']+/gi,"[已隐藏 URL]").replace(/\/media\/uploads\/[^\s"']+/gi,"[已隐藏媒体路径]")
  .replace(/\/storage\/v1\/object\/[^\s"']+/gi,"[已隐藏对象路径]").replace(/\bcommunity\/\d+\/[^\s"',;]+/gi,"[已隐藏对象键]")
  .replace(/\b(?:service[_ -]?role|api)[_ -]?key\b\s*[:=]\s*[^\s,;]+/gi,"[已隐藏凭据]").slice(0,500);}

function array(value:unknown):unknown[]|null{if(Array.isArray(value))return value;if(typeof value!=="string")return null;try{const parsed:unknown=JSON.parse(value);return Array.isArray(parsed)?parsed:null;}catch{return null;}}
function iso(value:string|Date|null){return value instanceof Date?value.toISOString():value;}
export function publicMediaCleanupJob(row:MediaCleanupJobRow){return{id:Number(row.id),ownerUserId:Number(row.owner_user_id),
  urlCount:(array(row.urls_json)||[]).filter(item=>typeof item==="string").length,status:row.status,attempts:Number(row.attempts),
  lastError:row.last_error?sanitizeMediaCleanupError(row.last_error):null,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at),
  completedAt:iso(row.completed_at),claimedAt:iso(row.claimed_at),ageSeconds:Math.max(0,Number(row.age_seconds)||0),stale:Boolean(row.is_stale),
  eligibleForRetry:row.status==="pending"||Boolean(row.is_stale)};}

export class MediaCleanupService{
  private readonly repository:MediaCleanupRepository;
  private readonly deleteReferences:(refs:StoredMediaReference[])=>Promise<void>;
  constructor(repository:MediaCleanupRepository,deleteReferences:(refs:StoredMediaReference[])=>Promise<void>){this.repository=repository;this.deleteReferences=deleteReferences;}
  async enqueue(userId:number,urls:Array<string|null|undefined>){const stored=[...new Set(urls.filter((v):v is string=>typeof v==="string"&&v.length>0))];
    const refs=describeStoredMediaUrls(userId,stored);return refs.length?this.repository.enqueue(userId,stored,refs):null;}
  async claim(jobId:number,staleMinutes=MEDIA_CLEANUP_STALE_MINUTES){return this.repository.claim(jobId,randomUUID(),staleMinutes);}
  async process(jobId:number){const job=await this.claim(jobId);if(!job||!job.claim_token)return false;try{const urls=array(job.urls_json);
    if(!urls||urls.some(url=>typeof url!=="string"))throw new Error(`媒体清理任务 ${jobId} 的 URL 数据无效`);
    const stored=job.objects_json==null?null:array(job.objects_json);if(job.objects_json!=null&&!stored)throw new Error(`媒体清理任务 ${jobId} 的对象定位数据无效`);
    const ownerUserId=Number(job.owner_user_id);const urlList=urls as string[];
    const refs=(job.objects_json==null?describeStoredMediaUrls(ownerUserId,urlList):stored) as StoredMediaReference[];
    if(urlList.some(url=>url.length>0)&&refs.length===0)throw new Error(`媒体清理任务 ${jobId} 无法定位任何存储对象，任务将保留等待重试`);
    await this.deleteReferences(refs);return this.repository.complete(jobId,job.claim_token);
  }catch(error){await this.repository.release(jobId,job.claim_token,sanitizeMediaCleanupError(error));throw error;}}
  async processPending(limit=25){const ids=await this.repository.pending(Math.max(1,Math.min(limit,100)),MEDIA_CLEANUP_STALE_MINUTES);let completed=0,failed=0;
    for(const id of ids)try{if(await this.process(id))completed+=1;}catch(error){failed+=1;console.error(`Unable to process media cleanup job ${id}:`,error);}
    return{checked:ids.length,completed,failed};}
  job(id:number){return this.repository.job(id,MEDIA_CLEANUP_STALE_MINUTES);}
  async list(input:{page?:unknown;pageSize?:unknown;status?:unknown;olderThanHours?:unknown}){const filters:MediaCleanupFilter[]=["all","attention","pending","processing","completed","failing","stale"];
    const page=Math.max(1,Number(input.page)||1),pageSize=Math.min(100,Math.max(10,Number(input.pageSize)||25));
    const status=filters.includes(input.status as MediaCleanupFilter)?input.status as MediaCleanupFilter:"all";
    const olderThanHours=Math.min(24*365,Math.max(0,Number(input.olderThanHours)||0));const result=await this.repository.list({page,pageSize,status,olderThanHours,staleMinutes:MEDIA_CLEANUP_STALE_MINUTES});
    return{items:result.rows.map(publicMediaCleanupJob),total:result.total,page,pageSize,status,olderThanHours,staleAfterMinutes:MEDIA_CLEANUP_STALE_MINUTES,summary:result.summary};}
}
export type {MediaCleanupJob};
