import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { CommunityRepository } from "./repository.js";
import type {
  AcceptResult,
  CreatePostInput,
  JoinResult,
  LevelSource,
  PostListInput,
  Row,
  ShareResult,
  ToggleResult,
} from "./types.js";

function postSelect(viewerParameter: number) {
  return `SELECT p.*,COALESCE(u.username,'食友'||p.user_id::text) AS username,
    COALESCE(u.is_verified_expert,FALSE) AS author_is_expert,
    (SELECT COUNT(*)::int FROM community_comments cc WHERE cc.post_id=p.id) AS actual_comment_count,
    EXISTS(SELECT 1 FROM community_post_likes l WHERE l.post_id=p.id AND l.user_id=$${viewerParameter}) AS is_liked,
    EXISTS(SELECT 1 FROM community_post_bookmarks b WHERE b.post_id=p.id AND b.user_id=$${viewerParameter}) AS is_bookmarked,
    (SELECT COUNT(*)::int FROM community_event_participants ep WHERE ep.post_id=p.id) AS participant_count,
    EXISTS(SELECT 1 FROM community_event_participants ep WHERE ep.post_id=p.id AND ep.user_id=$${viewerParameter}) AS is_joined,
    EXISTS(SELECT 1 FROM user_follows uf WHERE uf.follower_id=$${viewerParameter} AND uf.following_id=p.user_id) AS author_is_followed,
    lr.id AS linked_recipe_valid_id,lr.title AS linked_recipe_title,lr.image_url AS linked_recipe_image_url,
    lr.cook_time AS linked_recipe_cook_time,lr.difficulty AS linked_recipe_difficulty,lr.calories AS linked_recipe_calories
    FROM community_posts p LEFT JOIN users u ON u.id=p.user_id LEFT JOIN recipes lr ON lr.id=p.linked_recipe_id
    AND lr.deleted_at IS NULL AND lr.status='approved' AND COALESCE(lr.quality_status,'trusted')<>'needs_review'`;
}

function row(result: { rows: QueryResultRow[] }): Row | null {
  return (result.rows[0] as Row | undefined) || null;
}

export class PostgresCommunityRepository implements CommunityRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) { this.pool = pool; }

  async authUser(userId: number) {
    return row(await this.pool.query("SELECT id,username,avatar_url,role,is_verified_expert FROM users WHERE id=$1", [userId])) as Awaited<ReturnType<CommunityRepository["authUser"]>>;
  }

  async searchUsers(viewerId: number | null, pattern: string) {
    const result = viewerId
      ? await this.pool.query(`SELECT id,username,avatar_url,bio FROM users WHERE id<>$1
          AND username ILIKE $2 ESCAPE '\\' AND is_disabled=FALSE ORDER BY id DESC LIMIT 12`, [viewerId, pattern])
      : await this.pool.query(`SELECT id,username,avatar_url,bio FROM users
          WHERE username ILIKE $1 ESCAPE '\\' AND is_disabled=FALSE ORDER BY id DESC LIMIT 12`, [pattern]);
    return result.rows as Row[];
  }

  async following(userId: number) {
    return (await this.pool.query(`SELECT u.id,u.username,u.avatar_url,uf.created_at FROM user_follows uf JOIN users u ON u.id=uf.following_id
      WHERE uf.follower_id=$1 ORDER BY uf.created_at DESC`, [userId])).rows as Row[];
  }

  async levelSource(userId: number): Promise<LevelSource> {
    const counts = row(await this.pool.query(`SELECT
      (SELECT value FROM system_settings WHERE key='USER_LEVEL_RULE') AS "ruleJson",
      (SELECT COUNT(*) FROM diet_records WHERE user_id=$1) AS "dietRecordCount",
      (SELECT COUNT(*) FROM recipe_favorites WHERE user_id=$1) AS "favoriteCount",
      (SELECT COUNT(*) FROM community_posts WHERE user_id=$1 AND deleted_at IS NULL) AS "postCount",
      (SELECT COUNT(*) FROM user_follows WHERE following_id=$1) AS "followerCount",
      (SELECT COUNT(*) FROM user_daily_check_ins WHERE user_id=$1) AS "checkInCount",
      (SELECT COALESCE(SUM(xp_delta),0) FROM user_level_adjustments WHERE user_id=$1) AS "adjustmentXp"`, [userId]))!;
    const dates = (await this.pool.query("SELECT DISTINCT recorded_at FROM diet_records WHERE user_id=$1", [userId])).rows as Array<{ recorded_at: string }>;
    return {
      ruleJson: counts.ruleJson ? String(counts.ruleJson) : null,
      dietDates: dates.map((item) => item.recorded_at),
      dietRecordCount: Number(counts.dietRecordCount),
      favoriteCount: Number(counts.favoriteCount),
      postCount: Number(counts.postCount),
      followerCount: Number(counts.followerCount),
      checkInCount: Number(counts.checkInCount),
      adjustmentXp: Number(counts.adjustmentXp),
    };
  }

  async checkedIn(userId: number, date: string) {
    return Boolean((await this.pool.query("SELECT 1 FROM user_daily_check_ins WHERE user_id=$1 AND check_in_date=$2", [userId, date])).rowCount);
  }

  async checkIn(userId: number, date: string) {
    return (await this.pool.query(`INSERT INTO user_daily_check_ins (user_id,check_in_date) VALUES ($1,$2)
      ON CONFLICT (user_id,check_in_date) DO NOTHING`, [userId, date])).rowCount === 1;
  }

  async toggleFollow(userId: number, followingId: number): Promise<ToggleResult | { kind: "self" }> {
    if (userId === followingId) return { kind: "self" };
    return this.tx(async (client) => {
      await this.lock(client, `community:follow:${userId}:${followingId}`);
      if (!(await client.query("SELECT 1 FROM users WHERE id=$1", [followingId])).rowCount) return { kind: "not_found" as const };
      const exists = Boolean((await client.query("SELECT 1 FROM user_follows WHERE follower_id=$1 AND following_id=$2", [userId, followingId])).rowCount);
      if (exists) await client.query("DELETE FROM user_follows WHERE follower_id=$1 AND following_id=$2", [userId, followingId]);
      else await client.query("INSERT INTO user_follows (follower_id,following_id) VALUES ($1,$2)", [userId, followingId]);
      const count = Number((await client.query("SELECT COUNT(*) AS count FROM user_follows WHERE follower_id=$1", [userId])).rows[0].count);
      return { kind: "updated" as const, active: !exists, count };
    });
  }

  async profile(viewerId: number | null, profileUserId: number) {
    const user = row(await this.pool.query(`SELECT u.id,u.username,u.avatar_url,u.bio,
      (SELECT COUNT(*)::int FROM user_follows WHERE following_id=u.id) AS followers_count,
      (SELECT COUNT(*)::int FROM user_follows WHERE follower_id=u.id) AS following_count,
      (SELECT COUNT(*)::int FROM community_posts WHERE user_id=u.id AND deleted_at IS NULL) AS posts_count,
      EXISTS(SELECT 1 FROM user_follows WHERE follower_id=$1 AND following_id=u.id) AS is_following FROM users u WHERE u.id=$2`, [viewerId ?? -1, profileUserId]));
    if (!user) return null;
    const posts = (await this.pool.query(`SELECT p.id,p.category,p.content,CASE WHEN p.image_url LIKE 'data:%' THEN NULL ELSE p.image_url END AS image_url,
      p.likes_count,p.created_at FROM community_posts p WHERE p.user_id=$1 AND p.deleted_at IS NULL ORDER BY p.created_at DESC LIMIT 20`, [profileUserId])).rows as Row[];
    return { user, posts };
  }

  async maxPostId() {
    return Number((await this.pool.query("SELECT COALESCE(MAX(id),0) AS id FROM community_posts")).rows[0].id);
  }

  async listPosts(input: PostListInput) {
    const values: unknown[] = [input.userId ?? -1];
    const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
    const filters = ["p.deleted_at IS NULL"];
    if (input.category) filters.push(`p.category=${bind(input.category)}`);
    if (input.search) {
      const search = bind(`%${input.search}%`);
      filters.push(`(p.content ILIKE ${search} OR p.category ILIKE ${search} OR u.username ILIKE ${search} OR lr.title ILIKE ${search})`);
    }
    if (input.latestCursor) {
      const createdAt = bind(input.latestCursor.createdAt);
      const id = bind(input.latestCursor.id);
      filters.push(`(p.created_at<${createdAt} OR (p.created_at=${createdAt} AND p.id<${id}))`);
    }
    if (input.snapshotMaxId !== undefined) filters.push(`p.id<=${bind(input.snapshotMaxId)}`);
    const limit = bind(input.limit);
    const offset = bind(input.offset);
    return (await this.pool.query(`${postSelect(1)} WHERE ${filters.join(" AND ")}
      ORDER BY p.created_at DESC,p.id DESC LIMIT ${limit} OFFSET ${offset}`, values)).rows as Row[];
  }

  async viewPost(userId: number | null, postId: number) {
    return this.tx(async (client) => {
      if (!(await client.query("UPDATE community_posts SET views_count=COALESCE(views_count,0)+1 WHERE id=$1 AND deleted_at IS NULL", [postId])).rowCount) return null;
      return row(await client.query(`${postSelect(1)} WHERE p.id=$2 AND p.deleted_at IS NULL`, [userId ?? -1, postId]));
    });
  }

  async share(postId: number, userId: number | null, codes: string[], expiresAt: string): Promise<ShareResult | "not_found"> {
    return this.tx(async (client) => {
      if (!(await client.query("SELECT 1 FROM community_posts WHERE id=$1 AND deleted_at IS NULL", [postId])).rowCount) return "not_found";
      await this.lock(client, `community:share:${postId}:${userId ?? "anonymous"}`);
      await client.query("DELETE FROM community_share_codes WHERE expires_at<=CURRENT_TIMESTAMP");
      const existing = row(await client.query(`SELECT code,to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') AS expires_at
        FROM community_share_codes WHERE post_id=$1 AND created_by IS NOT DISTINCT FROM $2::int AND expires_at>CURRENT_TIMESTAMP
        ORDER BY expires_at DESC LIMIT 1`, [postId, userId]));
      if (existing) return { code: String(existing.code), expires_at: String(existing.expires_at), created: false };
      for (const code of codes) {
        const inserted = row(await client.query(`INSERT INTO community_share_codes (code,post_id,created_by,expires_at) VALUES ($1,$2,$3,$4)
          ON CONFLICT (code) DO NOTHING RETURNING code,to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') AS expires_at`, [code, postId, userId, expiresAt]));
        if (inserted) return { code: String(inserted.code), expires_at: String(inserted.expires_at), created: true };
      }
      return null;
    });
  }

  async resolveShare(code: string) {
    return row(await this.pool.query(`SELECT s.post_id,to_char(s.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') AS expires_at,
      p.content,COALESCE(u.username,p.username) AS username FROM community_share_codes s JOIN community_posts p ON p.id=s.post_id
      LEFT JOIN users u ON u.id=p.user_id
      WHERE s.code=$1 AND s.expires_at>CURRENT_TIMESTAMP AND p.deleted_at IS NULL`, [code]));
  }

  async createPost(input: CreatePostInput) {
    return this.tx(async (client) => {
      if (input.linkedRecipeId && !(await client.query(`SELECT 1 FROM recipes WHERE id=$1 AND deleted_at IS NULL
        AND status='approved' AND COALESCE(quality_status,'trusted')<>'needs_review'`, [input.linkedRecipeId])).rowCount) return { kind: "linked_recipe_not_public" as const };
      const inserted = row(await client.query(`INSERT INTO community_posts (user_id,username,avatar_url,category,content,image_url,image_urls,event_start_at,event_end_at,
        question_status,ip_location,linked_recipe_id,likes_count) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0) RETURNING id`,
      [input.userId, input.username, input.avatarUrl, input.category, input.content, input.imageUrls[0] || null,
        input.imageUrls.length ? JSON.stringify(input.imageUrls) : null, input.eventStartAt, input.eventEndAt, input.questionStatus, input.ipLocation, input.linkedRecipeId]))!;
      const post = row(await client.query(`${postSelect(1)} WHERE p.id=$2`, [input.userId, inserted.id]))!;
      return { kind: "created" as const, post };
    });
  }

  async toggleJoin(userId: number, postId: number, now: number): Promise<JoinResult> {
    return this.tx(async (client) => {
      await this.lock(client, `community:join:${postId}:${userId}`);
      const post = row(await client.query("SELECT id,category,event_end_at FROM community_posts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [postId]));
      if (!post || post.category !== "活动") return { kind: "not_found" };
      const exists = Boolean((await client.query("SELECT 1 FROM community_event_participants WHERE post_id=$1 AND user_id=$2", [postId, userId])).rowCount);
      if (!exists && post.event_end_at && new Date(post.event_end_at).getTime() < now) return { kind: "ended" };
      if (exists) await client.query("DELETE FROM community_event_participants WHERE post_id=$1 AND user_id=$2", [postId, userId]);
      else await client.query("INSERT INTO community_event_participants (post_id,user_id) VALUES ($1,$2)", [postId, userId]);
      const count = Number((await client.query("SELECT COUNT(*) AS count FROM community_event_participants WHERE post_id=$1", [postId])).rows[0].count);
      return { kind: "updated", active: !exists, count };
    });
  }

  async setPostBookmark(userId: number, postId: number, bookmarked: boolean) {
    return this.tx(async (client) => {
      // Row lock orders opposing requests and prevents saving a concurrently removed post.
      if (!(await client.query("SELECT 1 FROM community_posts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [postId])).rowCount) {
        return { kind: "not_found" as const };
      }
      if (bookmarked) await client.query(`INSERT INTO community_post_bookmarks (user_id,post_id) VALUES ($1,$2)
        ON CONFLICT (user_id,post_id) DO NOTHING`, [userId, postId]);
      else await client.query("DELETE FROM community_post_bookmarks WHERE user_id=$1 AND post_id=$2", [userId, postId]);
      return { kind: "updated" as const, bookmarked };
    });
  }

  async togglePostLike(userId: number, postId: number) { return this.toggleLike("post", userId, postId); }

  async comments(userId: number | null, postId: number) {
    return (await this.pool.query(`SELECT c.*,COALESCE(u.is_verified_expert,FALSE) AS is_expert_answer,
      CASE WHEN p.accepted_comment_id=c.id THEN TRUE ELSE FALSE END AS is_accepted,
      EXISTS(SELECT 1 FROM community_comment_likes l WHERE l.comment_id=c.id AND l.user_id=$1) AS is_liked
      FROM community_comments c JOIN community_posts p ON p.id=c.post_id LEFT JOIN users u ON u.id=c.user_id
      WHERE c.post_id=$2 AND p.deleted_at IS NULL ORDER BY is_accepted DESC,c.likes_count DESC,c.created_at DESC`, [userId ?? -1, postId])).rows as Row[];
  }

  async createComment(userId: number, postId: number, username: string, avatarUrl: string | null, content: string, imageUrl: string | null) {
    return this.tx(async (client) => {
      if (!(await client.query("SELECT 1 FROM community_posts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [postId])).rowCount) return null;
      const comment = row(await client.query(`INSERT INTO community_comments (post_id,user_id,username,avatar_url,content,image_url)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [postId, userId, username, avatarUrl, content, imageUrl]));
      await client.query("UPDATE community_posts SET comment_count=COALESCE(comment_count,0)+1 WHERE id=$1", [postId]);
      return comment;
    });
  }

  async acceptComment(userId: number, postId: number, commentId: number): Promise<AcceptResult> {
    return this.tx(async (client) => {
      const post = row(await client.query(`SELECT id,user_id,category,accepted_comment_id FROM community_posts
        WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [postId]));
      if (!post) return { kind: "not_found" };
      if (post.category !== "问答") return { kind: "not_question" };
      if (Number(post.user_id) !== userId) return { kind: "forbidden" };
      if (!(await client.query("SELECT 1 FROM community_comments WHERE id=$1 AND post_id=$2", [commentId, postId])).rowCount) return { kind: "comment_not_found" };
      const acceptedCommentId = Number(post.accepted_comment_id) === commentId ? null : commentId;
      await client.query("UPDATE community_posts SET accepted_comment_id=$1,question_status=$2 WHERE id=$3", [acceptedCommentId, acceptedCommentId ? "resolved" : "open", postId]);
      return { kind: "updated", acceptedCommentId };
    });
  }

  async toggleCommentLike(userId: number, commentId: number) { return this.toggleLike("comment", userId, commentId); }

  async recommendationSource(userId: number | null) {
    if (!userId) return { health: null, likedPosts: [] };
    const health = row(await this.pool.query(`SELECT health_goal,dietary_preference,allergies_json,dietary_restrictions_json,disliked_foods
      FROM user_health_profiles WHERE user_id=$1`, [userId]));
    const likedPosts = (await this.pool.query(`SELECT p.user_id,p.content FROM community_post_likes l JOIN community_posts p ON p.id=l.post_id
      WHERE l.user_id=$1 AND p.deleted_at IS NULL ORDER BY l.created_at DESC LIMIT 80`, [userId])).rows as Array<{ user_id: number; content: string }>;
    return { health, likedPosts };
  }

  private async toggleLike(kind: "post" | "comment", userId: number, id: number): Promise<ToggleResult> {
    return this.tx(async (client) => {
      await this.lock(client, `community:${kind}-like:${id}:${userId}`);
      const table = kind === "post" ? "community_posts" : "community_comments";
      const likeTable = kind === "post" ? "community_post_likes" : "community_comment_likes";
      const column = kind === "post" ? "post_id" : "comment_id";
      const target = kind === "post"
        ? await client.query("SELECT 1 FROM community_posts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [id])
        : await client.query(`SELECT 1 FROM community_comments c JOIN community_posts p ON p.id=c.post_id
            WHERE c.id=$1 AND p.deleted_at IS NULL FOR UPDATE OF c`, [id]);
      if (!target.rowCount) return { kind: "not_found" };
      const liked = Boolean((await client.query(`SELECT 1 FROM ${likeTable} WHERE ${column}=$1 AND user_id=$2`, [id, userId])).rowCount);
      if (liked) await client.query(`DELETE FROM ${likeTable} WHERE ${column}=$1 AND user_id=$2`, [id, userId]);
      else await client.query(`INSERT INTO ${likeTable} (${column},user_id) VALUES ($1,$2)`, [id, userId]);
      const updated = row(await client.query(`UPDATE ${table} SET likes_count=GREATEST(COALESCE(likes_count,0)+$1,0) WHERE id=$2 RETURNING likes_count`, [liked ? -1 : 1, id]))!;
      return { kind: "updated", active: !liked, count: Number(updated.likes_count) };
    });
  }

  private lock(client: PoolClient, key: string) {
    return client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [key]);
  }

  private async tx<T>(operation: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
