import { randomBytes } from "node:crypto";
import {
  recommendCommunityPosts,
  type CommunityRecommendationPost,
  type CommunityRecommendationProfile,
} from "../../services/communityRecommendation.js";
import { decodeCursor, encodeCursor } from "../../utils/cursor.js";
import { isStoredMediaUrlForUser } from "../../services/mediaStorage.js";
import { CommunityError } from "./errors.js";
import { checkInReward, levelFrom } from "./level.js";
import type { CommunityRepository } from "./repository.js";
import type { AuthUser, Row } from "./types.js";

const CANDIDATES=240,DEFAULT_LIMIT=12,MAX_LIMIT=30;
function parseList(value: unknown) { if (Array.isArray(value)) return value.flatMap((item)=>typeof item==="string"?[item]:item&&typeof item==="object"&&"name" in item&&typeof item.name==="string"?[item.name]:[]);
  if (typeof value!=="string"||!value.trim()) return []; try { return parseList(JSON.parse(value)); } catch { return value.split(/[、,，/;；\s]+/).filter(Boolean); } }
function serializePost(post: Row | null): (Row & CommunityRecommendationPost) | null { if(!post)return post; const { actual_comment_count:actual,nickname:_nickname,linked_recipe_valid_id:linkedId,
  linked_recipe_title:title,linked_recipe_image_url:image,linked_recipe_cook_time:cookTime,linked_recipe_difficulty:difficulty,
  linked_recipe_calories:calories,...value}=post; let images:string[]=[]; try { const parsed=typeof post.image_urls==="string"?JSON.parse(post.image_urls):post.image_urls;
    if(Array.isArray(parsed))images=parsed.filter((item):item is string=>typeof item==="string"); } catch { images=[]; } if(!images.length&&post.image_url)images=[post.image_url];
  return { ...value,id:Number(post.id),image_url:post.image_url||images[0]||null,image_urls:images,is_liked:Boolean(post.is_liked),is_bookmarked:Boolean(post.is_bookmarked),is_joined:Boolean(post.is_joined),
    author_is_followed:Boolean(post.author_is_followed),author_is_expert:Boolean(post.author_is_expert),comment_count:Number(actual??post.comment_count)||0,
    linked_recipe:linkedId?{ id:Number(linkedId),title:String(title),image_url:image?String(image):null,cook_time:Number(cookTime)||0,
      difficulty:String(difficulty||"难度未知"),calories:Number(calories)||0 }:null,linked_recipe_unavailable:Boolean(post.linked_recipe_id&&!linkedId) }; }
function publicComment(comment: Row) { const { nickname:_nickname,...value}=comment; return { ...value,is_liked:Boolean(comment.is_liked),
  is_expert_answer:Boolean(comment.is_expert_answer),is_accepted:Boolean(comment.is_accepted) }; }

export class CommunityService {
  private readonly repository: CommunityRepository;

  constructor(repository: CommunityRepository) { this.repository = repository; }
  authUser(userId:number|undefined) { return userId?this.repository.authUser(userId):Promise.resolve(null); }
  searchUsers(viewerId:number|null,query:unknown) { const value=String(query||"").trim(); return this.repository.searchUsers(viewerId,`%${value.replace(/[%_\\]/g,"\\$&")}%`); }
  following(userId:number) { return this.repository.following(userId); }
  async level(userId:number) { return levelFrom(await this.repository.levelSource(userId)); }
  async checkInStatus(userId:number,date:string) { const source=await this.repository.levelSource(userId); return { checkedIn:await this.repository.checkedIn(userId,date),date,xpReward:checkInReward(source) }; }
  async checkIn(userId:number,date:string) { const created=await this.repository.checkIn(userId,date); const source=await this.repository.levelSource(userId); const reward=checkInReward(source);
    return { status:created?201:200,body:{ checkedIn:true,alreadyCheckedIn:!created,date,awardedXp:created?reward:0,level:levelFrom(source) } }; }
  async toggleFollow(userId:number,followingId:number) { const result=await this.repository.toggleFollow(userId,followingId);
    if(result.kind==="self")throw new CommunityError(400,"不能关注自己"); if(result.kind==="not_found")throw new CommunityError(404,"用户不存在");
    return { is_following:result.active,following_count:result.count }; }
  async profile(viewerId:number|null,userId:number) { const result=await this.repository.profile(viewerId,userId); if(!result)throw new CommunityError(404,"用户不存在");
    return { ...result.user,is_following:Boolean(result.user.is_following),level:await this.level(userId),posts:result.posts }; }

  async posts(userId:number|null,query:Row) { const category=typeof query.category==="string"?query.category:""; const search=typeof query.search==="string"?query.search.trim().slice(0,80):"";
    const cursorMode=query.pageSize!==undefined||query.cursor!==undefined; const pageSize=Math.min(MAX_LIMIT,Math.max(1,Number(query.pageSize)||DEFAULT_LIMIT));
    const rawLimit=Number(query.limit),rawOffset=Number(query.offset); const limit=Number.isInteger(rawLimit)?Math.min(Math.max(rawLimit,1),MAX_LIMIT):DEFAULT_LIMIT;
    const offset=Number.isInteger(rawOffset)?Math.max(rawOffset,0):0; const mode=query.sort==="recommended"?"recommended":"latest";
    const rawCursor=query.cursor; const cursor=rawCursor?decodeCursor(rawCursor):null; if(rawCursor&&!cursor)throw this.cursorError(); const cursorId=cursor?Number(cursor.id):null;
    const valid=mode==="recommended"?[2,3,4].includes(Number(cursor?.v)):cursor?.v===2; if(cursor&&(!valid||cursor.mode!==mode||String(cursor.category||"")!==category
      ||!Number.isInteger(cursorId)||cursorId!<=0))throw this.cursorError(); const createdAt=typeof cursor?.createdAt==="string"?cursor.createdAt:"";
    if(cursor&&mode==="latest"&&!createdAt)throw this.cursorError(); const snapshotNow=mode==="recommended"&&cursor?Number(cursor.at):Date.now();
    if(mode==="recommended"&&!Number.isFinite(snapshotNow))throw this.cursorError(); const encodedMax=cursor?Number(cursor.maxId):null;
    if(cursor?.v===4&&(!Number.isInteger(encodedMax)||encodedMax!<0))throw this.cursorError(); const snapshotMaxId=mode==="recommended"?(cursor?.v===4?encodedMax!:await this.repository.maxPostId()):undefined;
    const rows=await this.repository.listPosts({ userId,category,search,latestCursor:mode==="latest"&&cursor?{createdAt,id:cursorId!}:undefined,
      snapshotMaxId,limit:mode==="recommended"?CANDIDATES:cursorMode?pageSize+1:limit,offset:mode==="latest"&&!cursorMode?offset:0 });
    const serialized=rows.map((row)=>serializePost(row)!); if(cursorMode) { let ordered=mode==="recommended"?recommendCommunityPosts(serialized,await this.profileForRecommendation(userId),snapshotNow):serialized;
      if(cursor&&mode==="recommended") { const index=ordered.findIndex((post)=>post.id===cursorId); if(index===-1)throw this.cursorError(); ordered=ordered.slice(index+1); }
      const items=ordered.slice(0,pageSize),last=items.at(-1); const nextCursor=items.length===pageSize&&last&&ordered.length>pageSize?encodeCursor(mode==="latest"
        ?{v:2,mode,category,createdAt:last.created_at,id:last.id}:{v:4,mode,category,at:snapshotNow,maxId:snapshotMaxId,id:last.id}):null;
      return { body:{items,nextCursor},candidates:rows.length }; }
    const ordered=mode==="recommended"?recommendCommunityPosts(serialized,await this.profileForRecommendation(userId)):serialized;
    return { body:mode==="latest"?ordered:ordered.slice(offset,offset+limit),candidates:rows.length };
  }
  async post(userId:number|null,postId:number) { const post=serializePost(await this.repository.viewPost(userId,postId)); if(!post)throw new CommunityError(404,"帖子不存在"); return post; }
  async share(postId:number,userId:number|null,baseUrl:string) { const expiresAt=new Date(Date.now()+30*86400000).toISOString().slice(0,19).replace("T"," "); const codes=Array.from({length:5},()=>randomBytes(5).toString("hex").toUpperCase());
    const result=await this.repository.share(postId,userId,codes,expiresAt); if(result==="not_found")throw new CommunityError(404,"帖子不存在"); if(!result)throw new CommunityError(503,"分享码生成失败，请稍后重试");
    return { status:result.created?201:200,body:{ code:result.code,url:`${baseUrl.replace(/\/$/,"")}/share/posts/${result.code}`,
      app_url:`dietdigidose://post-detail?id=${postId}&shareCode=${result.code}`,expires_at:result.expires_at } }; }
  async resolveShare(code:unknown) { const result=await this.repository.resolveShare(String(code||"").trim().toUpperCase()); if(!result)throw new CommunityError(404,"分享码无效或已过期"); return result; }
  async createPost(user:AuthUser,body:Row,ipLocation:string|null) { const imageUrls=Array.isArray(body.image_urls)?body.image_urls.filter((item):item is string=>typeof item==="string").slice(0,9):[];
    if(typeof body.image_url==="string"&&!imageUrls.length)imageUrls.push(body.image_url); const content=String(body.content||"").trim();
    if(!content&&!imageUrls.length&&!body.linked_recipe_id)throw new CommunityError(400,"动态内容、图片或关联菜谱不能为空");
    if(imageUrls.some((url)=>!isStoredMediaUrlForUser(url,user.id)))throw new CommunityError(400,"图片必须先通过当前账号上传");
    const category=["寻味","榜单","活动","问答"].includes(body.category)?body.category:"寻味"; let start:string|null=null,end:string|null=null;
    if(category==="活动") { start=String(body.event_start_at||"").trim(); end=String(body.event_end_at||"").trim(); const a=new Date(start).getTime(),b=new Date(end).getTime();
      if(!start||!end||!Number.isFinite(a)||!Number.isFinite(b))throw new CommunityError(400,"活动需要填写有效的开始和结束日期"); if(b<a)throw new CommunityError(400,"活动结束日期不能早于开始日期"); }
    const result=await this.repository.createPost({ userId:user.id,username:user.username||`食友${user.id}`,avatarUrl:user.avatar_url,category,content,imageUrls,
      eventStartAt:start,eventEndAt:end,questionStatus:category==="问答"?"open":null,ipLocation,linkedRecipeId:body.linked_recipe_id?Number(body.linked_recipe_id):null });
    if(result.kind==="linked_recipe_not_public")throw new CommunityError(400,"关联菜谱不存在、尚未公开或需要复核","LINKED_RECIPE_NOT_PUBLIC"); return serializePost(result.post); }
  async toggleJoin(userId:number,postId:number) { const result=await this.repository.toggleJoin(userId,postId,Date.now()); if(result.kind==="not_found")throw new CommunityError(404,"活动不存在");
    if(result.kind==="ended")throw new CommunityError(400,"活动已结束"); return { is_joined:result.active,participant_count:result.count }; }
  async setPostBookmark(userId: number, postId: number, bookmarked: boolean) {
    const result = await this.repository.setPostBookmark(userId, postId, bookmarked);
    if (result.kind === "not_found") throw new CommunityError(404, "帖子不存在");
    return { bookmarked: result.bookmarked };
  }
  async togglePostLike(userId:number,postId:number) { const result=await this.repository.togglePostLike(userId,postId); if(result.kind==="not_found")throw new CommunityError(404,"帖子不存在"); return { likes_count:result.count,is_liked:result.active }; }
  async comments(userId:number|null,postId:number) { return (await this.repository.comments(userId,postId)).map(publicComment); }
  async createComment(user:AuthUser,postId:number,body:Row) { const content=String(body.content||"").trim(),image=typeof body.image_url==="string"?body.image_url:null;
    if(!content&&!image)throw new CommunityError(400,"评论内容或图片不能为空"); if(image&&!isStoredMediaUrlForUser(image,user.id))throw new CommunityError(400,"图片必须先通过当前账号上传");
    const row=await this.repository.createComment(user.id,postId,user.username||`食友${user.id}`,user.avatar_url,content,image); if(!row)throw new CommunityError(404,"帖子不存在");
    return { ...row,is_liked:false,is_expert_answer:Boolean(user.is_verified_expert),is_accepted:false }; }
  async acceptComment(userId:number,postId:number,commentId:number) { const result=await this.repository.acceptComment(userId,postId,commentId);
    if(result.kind==="not_found"||result.kind==="not_question")throw new CommunityError(404,"问题不存在"); if(result.kind==="forbidden")throw new CommunityError(403,"只有提问者可以采纳回答");
    if(result.kind==="comment_not_found")throw new CommunityError(404,"回答不存在"); return { accepted_comment_id:result.acceptedCommentId,question_status:result.acceptedCommentId?"resolved":"open" }; }
  async toggleCommentLike(userId:number,commentId:number) { const result=await this.repository.toggleCommentLike(userId,commentId); if(result.kind==="not_found")throw new CommunityError(404,"评论不存在");
    return { likes_count:result.count,is_liked:result.active }; }
  private cursorError() { return new CommunityError(400,"分页游标无效","INVALID_CURSOR"); }
  private async profileForRecommendation(userId:number|null):Promise<CommunityRecommendationProfile> { if(!userId)return {userId:null,healthGoal:"healthy",likedPosts:[],restrictedTerms:[]};
    const {health,likedPosts}=await this.repository.recommendationSource(userId); return { userId,healthGoal:health?.health_goal||"healthy",dietaryPreference:health?.dietary_preference||"",likedPosts,
      restrictedTerms:[...parseList(health?.allergies_json),...parseList(health?.dietary_restrictions_json),...String(health?.disliked_foods||"").split(/[、,，/;；\s]+/)].filter(Boolean) }; }
}
