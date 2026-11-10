import type { StoredMediaReference } from "../../services/mediaStorage.js";
import type { MediaCleanupJob, MediaCleanupJobRow, MediaCleanupListQuery } from "./types.js";
export interface MediaCleanupRepository {
  enqueue(userId:number,urls:string[],objects:StoredMediaReference[]):Promise<number>;
  claim(jobId:number,claimToken:string,staleMinutes:number):Promise<MediaCleanupJob|null>;
  complete(jobId:number,claimToken:string):Promise<boolean>;
  release(jobId:number,claimToken:string,error:string):Promise<void>;
  pending(limit:number,staleMinutes:number):Promise<number[]>;
  job(jobId:number,staleMinutes:number):Promise<MediaCleanupJobRow|null>;
  list(query:MediaCleanupListQuery):Promise<{rows:MediaCleanupJobRow[];total:number;summary:Record<string,number>}>;
}
