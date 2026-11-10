import type Database from "better-sqlite3";
import type { CommunityRepository } from "./repository.js";
import type { AcceptResult, CreatePostInput, JoinResult, LevelSource, PostListInput, Row, ShareResult, ToggleResult } from "./types.js";

function selectPosts(userId:number|null) { const viewer=userId??-1; return `SELECT p.*,COALESCE(u.username,'食友'||p.user_id) AS username,
  COALESCE(u.is_verified_expert,0) AS author_is_expert,(SELECT COUNT(*) FROM community_comments cc WHERE cc.post_id=p.id) AS actual_comment_count,
  EXISTS(SELECT 1 FROM community_post_likes l WHERE l.post_id=p.id AND l.user_id=${viewer}) AS is_liked,
  EXISTS(SELECT 1 FROM community_post_bookmarks b WHERE b.post_id=p.id AND b.user_id=${viewer}) AS is_bookmarked,
  (SELECT COUNT(*) FROM community_event_participants ep WHERE ep.post_id=p.id) AS participant_count,
  EXISTS(SELECT 1 FROM community_event_participants ep WHERE ep.post_id=p.id AND ep.user_id=${viewer}) AS is_joined,
  EXISTS(SELECT 1 FROM user_follows uf WHERE uf.follower_id=${viewer} AND uf.following_id=p.user_id) AS author_is_followed,
  lr.id AS linked_recipe_valid_id,lr.title AS linked_recipe_title,lr.image_url AS linked_recipe_image_url,
  lr.cook_time AS linked_recipe_cook_time,lr.difficulty AS linked_recipe_difficulty,lr.calories AS linked_recipe_calories
  FROM community_posts p LEFT JOIN users u ON u.id=p.user_id LEFT JOIN recipes lr ON lr.id=p.linked_recipe_id
  AND lr.deleted_at IS NULL AND lr.status='approved' AND COALESCE(lr.quality_status,'trusted')<>'needs_review'`; }

export class SqliteCommunityRepository implements CommunityRepository {
  private readonly database: Database.Database;

  constructor(database: Database.Database) { this.database = database; }
  async authUser(userId:number) { return (this.database.prepare("SELECT id,username,avatar_url,role,is_verified_expert FROM users WHERE id=?").get(userId) as any)||null; }
  async searchUsers(viewerId:number|null,pattern:string) { return (viewerId?this.database.prepare(`SELECT id,username,avatar_url,bio FROM users WHERE id<>?
    AND username LIKE ? ESCAPE '\\' AND is_disabled=0 ORDER BY id DESC LIMIT 12`).all(viewerId,pattern):this.database.prepare(`SELECT id,username,avatar_url,bio FROM users
    WHERE username LIKE ? ESCAPE '\\' AND is_disabled=0 ORDER BY id DESC LIMIT 12`).all(pattern)) as Row[]; }
  async following(userId:number) { return this.database.prepare(`SELECT u.id,u.username,u.avatar_url,uf.created_at FROM user_follows uf JOIN users u ON u.id=uf.following_id
    WHERE uf.follower_id=? ORDER BY uf.created_at DESC`).all(userId) as Row[]; }
  async levelSource(userId:number):Promise<LevelSource> { const counts=this.database.prepare(`SELECT
    (SELECT value FROM system_settings WHERE key='USER_LEVEL_RULE') AS ruleJson,
    (SELECT COUNT(*) FROM diet_records WHERE user_id=?) AS dietRecordCount,
    (SELECT COUNT(*) FROM recipe_favorites WHERE user_id=?) AS favoriteCount,
    (SELECT COUNT(*) FROM community_posts WHERE user_id=? AND deleted_at IS NULL) AS postCount,
    (SELECT COUNT(*) FROM user_follows WHERE following_id=?) AS followerCount,
    (SELECT COUNT(*) FROM user_daily_check_ins WHERE user_id=?) AS checkInCount,
    (SELECT COALESCE(SUM(xp_delta),0) FROM user_level_adjustments WHERE user_id=?) AS adjustmentXp`).get(userId,userId,userId,userId,userId,userId) as any;
    const dates=(this.database.prepare("SELECT DISTINCT recorded_at FROM diet_records WHERE user_id=?").all(userId) as Array<{recorded_at:string}>).map((row)=>row.recorded_at);
    return { ...counts,dietDates:dates,dietRecordCount:Number(counts.dietRecordCount),favoriteCount:Number(counts.favoriteCount),postCount:Number(counts.postCount),
      followerCount:Number(counts.followerCount),checkInCount:Number(counts.checkInCount),adjustmentXp:Number(counts.adjustmentXp) }; }
  async checkedIn(userId:number,date:string) { return Boolean(this.database.prepare("SELECT 1 FROM user_daily_check_ins WHERE user_id=? AND check_in_date=?").get(userId,date)); }
  async checkIn(userId:number,date:string) { return this.database.prepare("INSERT OR IGNORE INTO user_daily_check_ins (user_id,check_in_date) VALUES (?,?)").run(userId,date).changes===1; }
  async toggleFollow(userId:number,followingId:number):Promise<ToggleResult|{kind:"self"}> { if(userId===followingId)return {kind:"self"}; return this.database.transaction(()=>{
    if(!this.database.prepare("SELECT 1 FROM users WHERE id=?").get(followingId))return {kind:"not_found" as const};
    const exists=Boolean(this.database.prepare("SELECT 1 FROM user_follows WHERE follower_id=? AND following_id=?").get(userId,followingId));
    if(exists)this.database.prepare("DELETE FROM user_follows WHERE follower_id=? AND following_id=?").run(userId,followingId);
    else this.database.prepare("INSERT INTO user_follows (follower_id,following_id) VALUES (?,?)").run(userId,followingId);
    const count=Number((this.database.prepare("SELECT COUNT(*) AS count FROM user_follows WHERE follower_id=?").get(userId) as any).count); return {kind:"updated" as const,active:!exists,count}; })(); }
  async profile(viewerId:number|null,profileUserId:number) { const user=this.database.prepare(`SELECT u.id,u.username,u.avatar_url,u.bio,
    (SELECT COUNT(*) FROM user_follows WHERE following_id=u.id) AS followers_count,(SELECT COUNT(*) FROM user_follows WHERE follower_id=u.id) AS following_count,
    (SELECT COUNT(*) FROM community_posts WHERE user_id=u.id AND deleted_at IS NULL) AS posts_count,
    EXISTS(SELECT 1 FROM user_follows WHERE follower_id=? AND following_id=u.id) AS is_following FROM users u WHERE u.id=?`).get(viewerId??-1,profileUserId) as Row|undefined;
    if(!user)return null; const posts=this.database.prepare(`SELECT p.id,p.category,p.content,CASE WHEN p.image_url LIKE 'data:%' THEN NULL ELSE p.image_url END AS image_url,
      p.likes_count,p.created_at FROM community_posts p WHERE p.user_id=? AND p.deleted_at IS NULL ORDER BY p.created_at DESC LIMIT 20`).all(profileUserId) as Row[]; return {user,posts}; }
  async maxPostId() { return Number((this.database.prepare("SELECT COALESCE(MAX(id),0) AS id FROM community_posts").get() as any).id); }
  async listPosts(input:PostListInput) { const filters=["p.deleted_at IS NULL"]; const values:Array<string|number>=[]; if(input.category){filters.push("p.category=?");values.push(input.category);}
    if(input.search){filters.push("(p.content LIKE ? OR p.category LIKE ? OR u.username LIKE ? OR lr.title LIKE ?)");const p=`%${input.search}%`;values.push(p,p,p,p);}
    if(input.latestCursor){filters.push("(p.created_at<? OR (p.created_at=? AND p.id<?))");values.push(input.latestCursor.createdAt,input.latestCursor.createdAt,input.latestCursor.id);}
    if(input.snapshotMaxId!==undefined){filters.push("p.id<=?");values.push(input.snapshotMaxId);} return this.database.prepare(`${selectPosts(input.userId)} WHERE ${filters.join(" AND ")}
      ORDER BY p.created_at DESC,p.id DESC LIMIT ? OFFSET ?`).all(...values,input.limit,input.offset) as Row[]; }
  async viewPost(userId:number|null,postId:number): Promise<Row | null> { return this.database.transaction(()=>{ const post=this.database.prepare(`${selectPosts(userId)} WHERE p.id=? AND p.deleted_at IS NULL`).get(postId) as Row|undefined;
    if(!post)return null; this.database.prepare("UPDATE community_posts SET views_count=COALESCE(views_count,0)+1 WHERE id=?").run(postId); return {...post,views_count:Number(post.views_count||0)+1}; })(); }
  async share(postId:number,userId:number|null,codes:string[],expiresAt:string):Promise<ShareResult|"not_found"> { return this.database.transaction(()=>{
    if(!this.database.prepare("SELECT 1 FROM community_posts WHERE id=? AND deleted_at IS NULL").get(postId))return "not_found" as const;
    this.database.prepare("DELETE FROM community_share_codes WHERE datetime(expires_at)<=CURRENT_TIMESTAMP").run(); const existing=this.database.prepare(`SELECT code,expires_at FROM community_share_codes
      WHERE post_id=? AND ((created_by=?) OR (created_by IS NULL AND ? IS NULL)) AND datetime(expires_at)>CURRENT_TIMESTAMP ORDER BY datetime(expires_at) DESC LIMIT 1`)
      .get(postId,userId,userId) as {code:string;expires_at:string}|undefined; if(existing)return {...existing,created:false};
    for(const code of codes)try { this.database.prepare("INSERT INTO community_share_codes (code,post_id,created_by,expires_at) VALUES (?,?,?,?)").run(code,postId,userId,expiresAt);
      return {code,expires_at:expiresAt,created:true}; } catch {} return null; })(); }
  async resolveShare(code:string) { return (this.database.prepare(`SELECT s.post_id,s.expires_at,p.content,COALESCE(u.username,p.username) AS username
    FROM community_share_codes s JOIN community_posts p ON p.id=s.post_id LEFT JOIN users u ON u.id=p.user_id
    WHERE s.code=? AND s.expires_at>CURRENT_TIMESTAMP AND p.deleted_at IS NULL`).get(code) as Row|undefined)||null; }
  async createPost(input:CreatePostInput) { return this.database.transaction(()=>{ if(input.linkedRecipeId&&!this.database.prepare(`SELECT 1 FROM recipes WHERE id=? AND deleted_at IS NULL
      AND status='approved' AND COALESCE(quality_status,'trusted')<>'needs_review'`).get(input.linkedRecipeId))return {kind:"linked_recipe_not_public" as const};
    const inserted=this.database.prepare(`INSERT INTO community_posts (user_id,username,avatar_url,category,content,image_url,image_urls,event_start_at,event_end_at,
      question_status,ip_location,linked_recipe_id,likes_count) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)`).run(input.userId,input.username,input.avatarUrl,input.category,input.content,
      input.imageUrls[0]||null,input.imageUrls.length?JSON.stringify(input.imageUrls):null,input.eventStartAt,input.eventEndAt,input.questionStatus,input.ipLocation,input.linkedRecipeId);
    const post=this.database.prepare(`${selectPosts(input.userId)} WHERE p.id=?`).get(inserted.lastInsertRowid) as Row; return {kind:"created" as const,post}; })(); }
  async toggleJoin(userId:number,postId:number,now:number):Promise<JoinResult> { return this.database.transaction(()=>{ const post=this.database.prepare(`SELECT id,category,event_end_at FROM community_posts
    WHERE id=? AND deleted_at IS NULL`).get(postId) as any; if(!post||post.category!=="活动")return {kind:"not_found" as const};
    const exists=Boolean(this.database.prepare("SELECT 1 FROM community_event_participants WHERE post_id=? AND user_id=?").get(postId,userId));
    if(!exists&&post.event_end_at&&new Date(post.event_end_at).getTime()<now)return {kind:"ended" as const};
    if(exists)this.database.prepare("DELETE FROM community_event_participants WHERE post_id=? AND user_id=?").run(postId,userId);
    else this.database.prepare("INSERT INTO community_event_participants (post_id,user_id) VALUES (?,?)").run(postId,userId);
    const count=Number((this.database.prepare("SELECT COUNT(*) AS count FROM community_event_participants WHERE post_id=?").get(postId) as any).count);
    return {kind:"updated" as const,active:!exists,count}; })(); }
  async setPostBookmark(userId: number, postId: number, bookmarked: boolean) {
    const result = this.updateReaction("bookmark", userId, postId, bookmarked);
    return result.kind === "not_found" ? result : { kind: "updated" as const, bookmarked: result.active };
  }
  async togglePostLike(userId:number,postId:number) { return this.updateReaction("post",userId,postId); }
  async comments(userId:number|null,postId:number) { return this.database.prepare(`SELECT c.*,COALESCE(u.is_verified_expert,0) AS is_expert_answer,
    CASE WHEN p.accepted_comment_id=c.id THEN 1 ELSE 0 END AS is_accepted,EXISTS(SELECT 1 FROM community_comment_likes l WHERE l.comment_id=c.id AND l.user_id=?) AS is_liked
    FROM community_comments c JOIN community_posts p ON p.id=c.post_id LEFT JOIN users u ON u.id=c.user_id WHERE c.post_id=? AND p.deleted_at IS NULL
    ORDER BY is_accepted DESC,c.likes_count DESC,c.created_at DESC`).all(userId??-1,postId) as Row[]; }
  async createComment(userId:number,postId:number,username:string,avatarUrl:string|null,content:string,imageUrl:string|null) { return this.database.transaction(()=>{
    if(!this.database.prepare("SELECT 1 FROM community_posts WHERE id=? AND deleted_at IS NULL").get(postId))return null;
    const inserted=this.database.prepare("INSERT INTO community_comments (post_id,user_id,username,avatar_url,content,image_url) VALUES (?,?,?,?,?,?)")
      .run(postId,userId,username,avatarUrl,content,imageUrl); this.database.prepare("UPDATE community_posts SET comment_count=COALESCE(comment_count,0)+1 WHERE id=?").run(postId);
    return this.database.prepare("SELECT * FROM community_comments WHERE id=?").get(inserted.lastInsertRowid) as Row; })(); }
  async acceptComment(userId:number,postId:number,commentId:number):Promise<AcceptResult> { return this.database.transaction(()=>{ const post=this.database.prepare(`SELECT id,user_id,category,accepted_comment_id
    FROM community_posts WHERE id=? AND deleted_at IS NULL`).get(postId) as any; if(!post)return {kind:"not_found" as const}; if(post.category!=="问答")return {kind:"not_question" as const};
    if(post.user_id!==userId)return {kind:"forbidden" as const}; if(!this.database.prepare("SELECT 1 FROM community_comments WHERE id=? AND post_id=?").get(commentId,postId))return {kind:"comment_not_found" as const};
    const accepted=post.accepted_comment_id===commentId?null:commentId; this.database.prepare("UPDATE community_posts SET accepted_comment_id=?,question_status=? WHERE id=?")
      .run(accepted,accepted?"resolved":"open",postId); return {kind:"updated" as const,acceptedCommentId:accepted}; })(); }
  async toggleCommentLike(userId:number,commentId:number) { return this.updateReaction("comment",userId,commentId); }
  async recommendationSource(userId:number|null) { if(!userId)return {health:null,likedPosts:[]}; const health=(this.database.prepare(`SELECT health_goal,dietary_preference,allergies_json,
    dietary_restrictions_json,disliked_foods FROM user_health_profiles WHERE user_id=?`).get(userId) as Row|undefined)||null;
    const likedPosts=this.database.prepare(`SELECT p.user_id,p.content FROM community_post_likes l JOIN community_posts p ON p.id=l.post_id WHERE l.user_id=?
      AND p.deleted_at IS NULL ORDER BY l.created_at DESC LIMIT 80`).all(userId) as Array<{user_id:number;content:string}>; return {health,likedPosts}; }
  /** Write a post/comment relationship transactionally. Bookmarks use desired state, never a toggle or like counter. */
  private updateReaction(kind: "post" | "comment" | "bookmark", userId: number, id: number, desired?: boolean): ToggleResult {
    return this.database.transaction((): ToggleResult => {
      const table = kind === "comment" ? "community_comments" : "community_posts";
      const relationTable = kind === "bookmark" ? "community_post_bookmarks" : kind === "post" ? "community_post_likes" : "community_comment_likes";
      const column = kind === "comment" ? "comment_id" : "post_id";
      const existsTarget = kind !== "comment" ? this.database.prepare("SELECT 1 FROM community_posts WHERE id=? AND deleted_at IS NULL").get(id)
        : this.database.prepare(`SELECT 1 FROM community_comments c JOIN community_posts p ON p.id=c.post_id WHERE c.id=? AND p.deleted_at IS NULL`).get(id);
      if (!existsTarget) return { kind: "not_found" };
      const current = Boolean(this.database.prepare(`SELECT 1 FROM ${relationTable} WHERE ${column}=? AND user_id=?`).get(id, userId));
      const active = desired ?? !current;
      if (current !== active) {
        if (!active) this.database.prepare(`DELETE FROM ${relationTable} WHERE ${column}=? AND user_id=?`).run(id, userId);
        else this.database.prepare(`INSERT INTO ${relationTable} (${column},user_id) VALUES (?,?)`).run(id, userId);
      }
      if (kind === "bookmark") return { kind: "updated", active, count: 0 };
      this.database.prepare(`UPDATE ${table} SET likes_count=MAX(COALESCE(likes_count,0)+?,0) WHERE id=?`).run(current ? -1 : 1, id);
      const count = Number((this.database.prepare(`SELECT likes_count AS count FROM ${table} WHERE id=?`).get(id) as any).count);
      return { kind: "updated", active, count };
    })();
  }
}
