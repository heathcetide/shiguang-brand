import{deleteStoredMediaReferences}from"../../services/mediaStorage.js";import{db}from"../../storage/db.js";import{MEDIA_CLEANUP_STALE_MINUTES,MediaCleanupService,publicMediaCleanupJob,sanitizeMediaCleanupError}from"./service.js";import{SqliteMediaCleanupRepository}from"./sqliteRepository.js";
export const mediaCleanupService=new MediaCleanupService(new SqliteMediaCleanupRepository(db),deleteStoredMediaReferences);
export const enqueueMediaCleanup=(userId:number,urls:Array<string|null|undefined>)=>mediaCleanupService.enqueue(userId,urls);
export const claimMediaCleanupJob=(jobId:number,staleMinutes=MEDIA_CLEANUP_STALE_MINUTES)=>mediaCleanupService.claim(jobId,staleMinutes);
export const processMediaCleanupJob=(jobId:number)=>mediaCleanupService.process(jobId);
export const processPendingMediaCleanupJobs=(limit=25)=>mediaCleanupService.processPending(limit);
export{MEDIA_CLEANUP_STALE_MINUTES,publicMediaCleanupJob,sanitizeMediaCleanupError};
export type{MediaCleanupJob}from"./types.js";
