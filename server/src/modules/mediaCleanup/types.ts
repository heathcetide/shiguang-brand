export type MediaCleanupStatus = "pending" | "processing" | "completed";
export type MediaCleanupJob = {
  id:number; owner_user_id:number; urls_json:unknown; objects_json:unknown; status:MediaCleanupStatus;
  attempts:number; last_error:string|null; created_at:string|Date; updated_at:string|Date;
  completed_at:string|Date|null; claim_token:string|null; claimed_at:string|Date|null;
};
export type MediaCleanupJobRow = MediaCleanupJob & { age_seconds:number|string; is_stale:boolean|number };
export type MediaCleanupFilter = "all"|"attention"|"pending"|"processing"|"completed"|"failing"|"stale";
export type MediaCleanupListQuery = { page:number; pageSize:number; status:MediaCleanupFilter; olderThanHours:number; staleMinutes:number };
