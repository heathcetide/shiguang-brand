import { resolveMediaUrl } from "@/utils/mediaUrl";
import { useFocusEffect } from "expo-router";
import { usePostBookmark } from "./usePostBookmark";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  TextInput,
  Alert,
  Dimensions,
  Keyboard,
  Modal,
  Platform,
  Share,
  useWindowDimensions,
  type KeyboardEvent,
} from "react-native";
import { Screen } from "@/components/Screen";
import { useSafeRouter, useSafeSearchParams } from "@/hooks/useSafeRouter";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { getAvatarSource } from "@/utils/defaultAvatar";
import { formatLocalDateTime, formatLocalPostDate, parseUtcDatabaseDate } from "@/utils/postDate";
import { calculateKeyboardInset } from "@/utils/commentComposerKeyboard";
import { communityApi, mediaApi } from "@/services/api";
import { LinkedRecipeCard, type LinkedRecipeSummary } from "@/components/LinkedRecipeCard";


interface Post {
  id: number;
  user_id: number;
  username: string;
  avatar_url: string;
  category?: string;
  content: string;
  image_url: string | null;
  image_urls?: string[] | string | null;
  likes_count: number;
  views_count?: number;
  comment_count?: number;
  is_liked?: boolean;
  is_bookmarked?: boolean;
  event_start_at?: string | null;
  event_end_at?: string | null;
  participant_count?: number;
  is_joined?: boolean;
  question_status?: "open" | "resolved" | null;
  accepted_comment_id?: number | null;
  author_is_expert?: boolean;
  author_is_followed?: boolean;
  ip_location?: string | null;
  created_at: string;
  linked_recipe?: LinkedRecipeSummary | null;
  linked_recipe_unavailable?: boolean;
}

interface CommentItem {
  id: number;
  username: string;
  avatar_url: string;
  content: string;
  image_url?: string | null;
  created_at: string;
  likes_count: number;
  is_liked?: boolean;
  is_expert_answer?: boolean;
  is_accepted?: boolean;
}

interface MentionUser {
  id: number;
  username: string;
  avatar_url: string | null;
}

const EMOJI_OPTIONS = [0x1f60a, 0x1f60b, 0x1f60d, 0x1f44d, 0x1f525, 0x1f389, 0x1f64c, 0x1f60e]
  .map((codePoint) => String.fromCodePoint(codePoint));

type PendingPostAction = "like" | "follow" | "join" | "comment" | "comment-like" | "collect";

const getPostImages = (post: Post): string[] => {
  if (Array.isArray(post.image_urls)) return post.image_urls;
  if (typeof post.image_urls === "string") {
    try {
      const parsed = JSON.parse(post.image_urls);
      if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string");
    } catch {
      // 旧数据使用单图字段，回退处理即可。
    }
  }
  return post.image_url ? [post.image_url] : [];
};

export default function PostDetailScreen() {
  const router = useSafeRouter();
  const insets = useSafeAreaInsets();
  const { width: viewportWidth } = useWindowDimensions();
  const params = useSafeSearchParams<{
    id?: number | string;
    postData?: Post | string;
    pendingAction?: PendingPostAction;
    commentId?: number | string;
    published?: boolean | string;
  }>();
  const { isAuthenticated, user, sessionGeneration } = useAuth();
  const authFetch = useAuthFetch();

  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailError, setDetailError] = useState<"unavailable" | "load" | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followPending, setFollowPending] = useState(false);
  const detailScope = `${sessionGeneration}:${user?.id}:${params.id}`;
  const detailScopeRef = useRef(detailScope);
  detailScopeRef.current = detailScope;
  const detailRequest = useRef(0);
  const bookmarkWriteGeneration = useRef(0);
  const [bookmarkReadGeneration, setBookmarkReadGeneration] = useState(-1);
  const [detailRevision, setDetailRevision] = useState(0);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);

  // 评论列表
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [commentText, setCommentText] = useState("");
  const [commentImageUrl, setCommentImageUrl] = useState<string | null>(null);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [isCommentComposerVisible, setIsCommentComposerVisible] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [failedImageUrls, setFailedImageUrls] = useState<string[]>([]);
  const [showPublishedFeedback, setShowPublishedFeedback] = useState(
    params.published === true || params.published === "true",
  );
  const [isEmojiPickerVisible, setIsEmojiPickerVisible] = useState(false);
  const [isMentionPickerVisible, setIsMentionPickerVisible] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionUsers, setMentionUsers] = useState<MentionUser[]>([]);
  const [keyboardTop, setKeyboardTop] = useState<number | null>(null);
  const [composerHeight, setComposerHeight] = useState(0);
  const [, setDimensionsRevision] = useState(0);

  useEffect(() => {
    const subscription = Dimensions.addEventListener("change", () => {
      setDimensionsRevision((r) => r + 1);
    });
    return () => subscription?.remove();
  }, []);

  const effectiveViewportHeight = composerHeight > 0
    ? composerHeight
    : (Dimensions.get("screen")?.height ?? 0);
  const keyboardInset = keyboardTop === null ? 0
    : calculateKeyboardInset(effectiveViewportHeight, keyboardTop);
  const commentInputRef = useRef<TextInput>(null);

  const fetchPostDetail = useCallback(async () => {
    if (!params.id) {
      setLoading(false);
      return;
    }

    const request = ++detailRequest.current;
    const readGeneration = bookmarkWriteGeneration.current;
    const current = () => detailScopeRef.current === detailScope && detailRequest.current === request;
    try {
      setLoading(true);
      setDetailError(null);
      const [data, commentsData] = await Promise.all([
        communityApi.post<Post>(Number(params.id), authFetch),
        communityApi.comments<CommentItem>(Number(params.id), authFetch),
      ]);
      if (!current()) return;
      setBookmarkReadGeneration(readGeneration);
      setDetailRevision(request);
      setLoadedScope(detailScope);
      setPost(data);
      setIsFollowing(Boolean(data.author_is_followed));
      setComments(commentsData);
    } catch (e) {
      if (current()) {
        setPost(null); setLoadedScope(null); setComments([]);
        setDetailError(typeof e === "object" && e !== null && "status" in e && e.status === 404 ? "unavailable" : "load");
      }
      console.error(e);
    } finally {
      if (current()) setLoading(false);
    }
  }, [params.id, authFetch, detailScope]);

  useFocusEffect(useCallback(() => {
    void fetchPostDetail();
    return () => { detailRequest.current += 1; };
  }, [fetchPostDetail]));

  const bookmark = usePostBookmark(Number(params.id) || undefined,
    loadedScope === detailScope ? post?.is_bookmarked : undefined, fetchPostDetail, detailRevision, { readGeneration: bookmarkReadGeneration, writeGeneration: bookmarkWriteGeneration });

  useEffect(() => {
    if (params.published === true || params.published === "true") {
      router.setParams({ published: undefined });
    }
  }, [params.published, router]);

  useEffect(() => {
    setFailedImageUrls([]);
  }, [post?.id]);

  useEffect(() => {
    if (!isCommentComposerVisible) {
      setKeyboardTop(null);
      setComposerHeight(0);
      return;
    }

    const updateKeyboardInset = (event: KeyboardEvent) => {
      Keyboard.scheduleLayoutAnimation(event);
      setKeyboardTop(event.endCoordinates.screenY);
    };
    const resetKeyboardInset = () => {
      setKeyboardTop(null);
    };
    const showEvent = Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSubscription = Keyboard.addListener(showEvent, updateKeyboardInset);
    const hideSubscription = Keyboard.addListener(hideEvent, resetKeyboardInset);
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [isCommentComposerVisible]);

  const goToLogin = (pendingAction: PendingPostAction, commentId?: number) => {
    if (!post) return;
    setIsCommentComposerVisible(false);
    Keyboard.dismiss();
    router.push("/login", {
      returnTo: {
        pathname: "/post-detail",
        params: {
          id: post.id,
          pendingAction,
          ...(commentId ? { commentId } : {}),
        },
      },
    });
  };

  const promptForLogin = (title: string, message: string, pendingAction: PendingPostAction, commentId?: number) => {
    Alert.alert(title, message, [
      { text: "取消", style: "cancel" },
      { text: "去登录", onPress: () => goToLogin(pendingAction, commentId) },
    ]);
  };

  useEffect(() => {
    if (!isAuthenticated || !post || !params.pendingAction) return;
    const pendingAction = params.pendingAction;
    router.setParams({ pendingAction: undefined, commentId: undefined });
    if (pendingAction === "comment") {
      setIsCommentComposerVisible(true);
      return;
    }
    const actionLabel: Record<Exclude<PendingPostAction, "comment">, string> = {
      like: "点赞帖子",
      follow: "关注作者",
      join: "参加活动",
      "comment-like": "点赞评论",
      collect: "收藏帖子",
    };
    Alert.alert("已返回原帖", `请再次点击“${actionLabel[pendingAction]}”完成操作。`);
  }, [isAuthenticated, params.pendingAction, post?.id]);

  const handleLike = async () => {
    if (!post) return;
    if (!isAuthenticated) {
      promptForLogin("登录后点赞", "登录后即可点赞支持这篇分享。", "like");
      return;
    }
    const newLiked = !post.is_liked;
    const newCount = newLiked ? post.likes_count + 1 : post.likes_count - 1;

    setPost({
      ...post,
      is_liked: newLiked,
      likes_count: newCount,
    });

    try {
      const data = await communityApi.toggleLike(authFetch, post.id);
      setPost((current) => current ? { ...current, likes_count: data.likes_count, is_liked: data.is_liked } : current);
    } catch (e) {
      fetchPostDetail();
    }
  };

  const handleFollow = async () => {
    if (!post || followPending) return;
    if (!isAuthenticated) {
      promptForLogin("登录后关注", "登录后即可关注这位创作者。", "follow");
      return;
    }
    if (post.user_id === user?.id) return;
    const previous = isFollowing;
    setFollowPending(true);
    setIsFollowing(!previous);
    try {
      const result = await communityApi.toggleFollow(authFetch, post.user_id);
      setIsFollowing(result.is_following);
    }
    catch { setIsFollowing(previous); }
    finally { setFollowPending(false); }
  };

  const handleJoinEvent = async () => {
    if (!post) return;
    if (!isAuthenticated) {
      promptForLogin("登录后参加", "登录后即可参加社区活动。", "join");
      return;
    }
    const previousPost = post;
    setPost({
      ...post,
      is_joined: !post.is_joined,
      participant_count: Math.max(0, (post.participant_count || 0) + (post.is_joined ? -1 : 1)),
    });
    try {
      const data = await communityApi.toggleJoin(authFetch, post.id);
      setPost((current) => current ? {
        ...current,
        is_joined: Boolean(data.is_joined),
        participant_count: Number(data.participant_count) || 0,
      } : current);
    } catch (error) {
      setPost(previousPost);
      Alert.alert("操作失败", error instanceof Error ? error.message : "请稍后重试");
    }
  };

  const handleAcceptAnswer = async (commentId: number) => {
    if (!post || post.category !== "问答") return;
    try {
      const data = await communityApi.acceptComment<{ accepted_comment_id: number; question_status: "open" | "resolved" }>(authFetch, post.id, commentId);
      setPost((current) => current ? {
        ...current,
        accepted_comment_id: data.accepted_comment_id,
        question_status: data.question_status,
      } : current);
      setComments((current) => current.map((comment) => ({
        ...comment,
        is_accepted: comment.id === data.accepted_comment_id,
      })));
    } catch (error) {
      Alert.alert("操作失败", error instanceof Error ? error.message : "请稍后重试");
    }
  };

  const handleAddComment = async () => {
    if (!commentText.trim() && !commentImageUrl) {
      Alert.alert("提示", "请输入评论内容或添加一张图片");
      return;
    }

    if (!isAuthenticated || !post) {
      promptForLogin("登录后评论", "登录后即可参与讨论。", "comment");
      return;
    }
    try {
      setSubmittingComment(true);
      const storedImageUrl = commentImageUrl?.startsWith("data:")
        ? (await mediaApi.uploadImage(authFetch, commentImageUrl)).url
        : commentImageUrl;
      const comment = await communityApi.createComment<CommentItem>(authFetch, post.id, { content: commentText.trim(), image_url: storedImageUrl });
      setComments((current) => [comment, ...current]);
      setPost((current) => current ? { ...current, comment_count: (current.comment_count || 0) + 1 } : current);
      setCommentText("");
      setCommentImageUrl(null);
      setIsEmojiPickerVisible(false);
      setIsMentionPickerVisible(false);
      setIsCommentComposerVisible(false);
      Keyboard.dismiss();
    } catch (error) {
      Alert.alert("评论失败", error instanceof Error ? error.message : "请稍后重试");
    } finally {
      setSubmittingComment(false);
    }
  };

  const openCommentComposer = () => {
    if (!isAuthenticated) {
      promptForLogin("登录后评论", "登录后即可参与讨论。", "comment");
      return;
    }
    setIsCommentComposerVisible(true);
  };

  const closeCommentComposer = () => {
    setIsCommentComposerVisible(false);
    setIsEmojiPickerVisible(false);
    setIsMentionPickerVisible(false);
    setComposerHeight(0);
    setKeyboardTop(null);
    Keyboard.dismiss();
  };

  const pickCommentImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.65,
      base64: true,
    });
    const asset = result.assets?.[0];
    if (result.canceled || !asset?.base64) return;
    setCommentImageUrl(`data:${asset.mimeType || "image/jpeg"};base64,${asset.base64}`);
  };

  const loadMentionUsers = useCallback(async (query = "") => {
    try {
      setMentionUsers(await communityApi.users<MentionUser>(authFetch, query));
    } catch {
      setMentionUsers([]);
    }
  }, [authFetch]);

  const openMentionPicker = () => {
    if (!isAuthenticated) {
      promptForLogin("登录后使用 @", "登录后即可搜索并提及其他食友。", "comment");
      return;
    }
    setIsMentionPickerVisible(true);
    setIsEmojiPickerVisible(false);
    setMentionQuery("");
    loadMentionUsers();
  };

  const selectMention = (user: MentionUser) => {
    setCommentText((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}@${user.username} `);
    setIsMentionPickerVisible(false);
    commentInputRef.current?.focus();
  };

  const handleLikeComment = async (commentId: number) => {
    if (!isAuthenticated) {
      promptForLogin("登录后点赞", "登录后即可点赞评论。", "comment-like", commentId);
      return;
    }
    const target = comments.find((comment) => comment.id === commentId);
    if (!target) return;
    setComments((prev) =>
      prev.map((c) =>
        c.id === commentId
          ? {
              ...c,
              is_liked: !c.is_liked,
              likes_count: c.is_liked ? c.likes_count - 1 : c.likes_count + 1,
            }
          : c
      )
    );
    try {
      const data = await communityApi.toggleCommentLike(authFetch, commentId);
      setComments((prev) => prev.map((comment) => comment.id === commentId ? { ...comment, likes_count: data.likes_count, is_liked: data.is_liked } : comment));
    } catch {
      setComments((prev) => prev.map((comment) => comment.id === commentId ? target : comment));
    }
  };

  const handleShare = async () => {
    if (!post) return;
    try {
      const share = await communityApi.createShare(authFetch, post.id);
      await Share.share({
        message: `【食光社区】查看来自 ${post.username} 的健康分享：${post.content.slice(0, 50)}…\n分享码：SG${share.code}\n${share.url}\n打开 App：${share.app_url}`,
      });
    } catch (error) {
      Alert.alert("分享失败", error instanceof Error ? error.message : "请稍后重试");
    }
  };

  if (loading) {
    return (
      <Screen safeAreaEdges={["top"]}>
        <View className="flex-1 justify-center items-center">
          {showPublishedFeedback ? (
            <View className="mb-5 flex-row items-center gap-2 rounded-2xl bg-brand-soft px-4 py-3">
              <FontAwesome6 name="circle-check" size={16} colorClassName="accent-brand" />
              <Text className="text-sm font-bold text-brand">发布成功，正在打开动态…</Text>
            </View>
          ) : null}
          <ActivityIndicator size="large" colorClassName="accent-brand" />
        </View>
      </Screen>
    );
  }

  if (!post) {
    return (
      <Screen safeAreaEdges={["top"]}>
        <View className="flex-1 justify-center items-center p-6">
          <FontAwesome6 name="triangle-exclamation" size={40} colorClassName="accent-copy-muted" />
          <Text className="text-base text-ink font-bold mt-4">{detailError === "load" ? "帖子加载失败，请稍后重试" : "帖子未找到或已被删除"}</Text>
          {detailError === "load" && <TouchableOpacity accessibilityLabel="重新加载帖子" onPress={() => void fetchPostDetail()} className="mt-4 px-5 py-2 rounded-full bg-brand">
            <Text className="text-white font-bold">重试</Text>
          </TouchableOpacity>}
          <TouchableOpacity
            onPress={() => router.back()}
            className="mt-6 bg-brand-fill px-6 py-2.5 rounded-full"
          >
            <Text className="text-white font-bold">返回社区</Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  const postImages = getPostImages(post).filter((imageUrl) => !failedImageUrls.includes(imageUrl));
  const activityEnded = post.category === "活动" && Boolean(
    parseUtcDatabaseDate(post.event_end_at) && parseUtcDatabaseDate(post.event_end_at)!.getTime() < Date.now()
  );

  return (
    <Screen safeAreaEdges={["top", "left", "right"]}>
      <View className="flex-1">
        {/* 全新独立顶栏 Navbar */}
        <View className="flex-row items-center px-4 py-3 border-b border-line bg-surface z-20">
          <TouchableOpacity
            onPress={() => router.back()}
            className="h-9 w-9 shrink-0 rounded-full bg-background-secondary items-center justify-center active:bg-line"
          >
            <FontAwesome6 name="chevron-left" size={16} colorClassName="accent-brand" />
          </TouchableOpacity>

          {/* 作者信息简况 */}
          <View className="mx-3 min-w-0 flex-1 flex-row items-center gap-2.5">
            <TouchableOpacity onPress={() => router.push("/user-profile", { userId: post.user_id })} className="min-w-0 flex-1 flex-row items-center gap-2.5">
              <Image
                source={getAvatarSource(post.avatar_url, post.user_id ?? post.username)}
                className="h-8 w-8 shrink-0 rounded-full border border-brand/20"
              />
              <View className="min-w-0 flex-1">
                <Text
                  className="text-xs font-bold text-ink"
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  maxFontSizeMultiplier={1.2}
                >
                  {post.username}
                </Text>
                <Text
                  className="mt-0.5 text-[9px] text-copy-muted"
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  maxFontSizeMultiplier={1.2}
                >
                  {formatLocalPostDate(post.created_at)}发布
                </Text>
              </View>
            </TouchableOpacity>

            {/* 关注按钮 */}
            <TouchableOpacity
              disabled={followPending}
              onPress={() => void handleFollow()}
              className={`shrink-0 px-3 py-1 rounded-full border ${followPending ? "opacity-60" : ""} ${
                isFollowing
                  ? "bg-background-secondary border-line"
                  : "bg-brand-fill border-brand"
              }`}
            >
              <Text
                className={`text-[11px] font-bold ${
                  isFollowing ? "text-copy-muted" : "text-white"
                }`}
              >
                  {followPending ? "处理中" : isFollowing ? "已关注" : "+ 关注"}
              </Text>
            </TouchableOpacity>
          </View>

          <View className="shrink-0 flex-row items-center gap-2">
            <TouchableOpacity
              onPress={handleShare}
              accessibilityRole="button"
              accessibilityLabel="分享帖子"
              className="w-9 h-9 rounded-full bg-background-secondary items-center justify-center"
            >
              <FontAwesome6 name="arrow-up-from-bracket" size={15} colorClassName="accent-brand" />
            </TouchableOpacity>
          </View>
        </View>

        {showPublishedFeedback ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="关闭发布成功提示"
            onPress={() => setShowPublishedFeedback(false)}
            className="mx-4 mt-3 flex-row items-center justify-between rounded-2xl border border-brand/20 bg-brand-soft px-4 py-3"
          >
            <View className="flex-row items-center gap-2">
              <FontAwesome6 name="circle-check" size={15} colorClassName="accent-brand" />
              <Text className="text-xs font-bold text-brand">发布成功，动态已保存</Text>
            </View>
            <FontAwesome6 name="xmark" size={13} colorClassName="accent-brand" />
          </TouchableOpacity>
        ) : null}

        {/* 帖子正文主区域 */}
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 88 + insets.bottom }}
          className="flex-1 bg-surface"
        >
          {/* 大图全屏化展示 */}
          {postImages.length ? (
            <View className="w-full bg-black/5 relative">
              <View>
                <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
                  {postImages.map((imageUrl, index) => (
                    <TouchableOpacity
                      key={`${imageUrl.slice(-24)}-${index}`}
                      onPress={() => setPreviewImageUrl(imageUrl)}
                      activeOpacity={0.94}
                      className="bg-black/5"
                      style={{ width: viewportWidth }}
                      accessibilityRole="button"
                      accessibilityLabel={`查看第 ${index + 1} 张帖子图片大图`}
                    >
                      <Image
                        source={{ uri: resolveMediaUrl(imageUrl) }}
                        className="w-full h-80"
                        resizeMode="cover"
                        onError={() => setFailedImageUrls((current) => current.includes(imageUrl) ? current : [...current, imageUrl])}
                      />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
              {/* 分类浮标 */}
              <View className="absolute top-3 left-3 bg-black/50 backdrop-blur-md px-3 py-1 rounded-full border border-white/20">
                <Text className="text-[11px] font-bold text-white">#{post.category || "寻味"}</Text>
              </View>
              <View className="absolute right-3 bottom-3 bg-black/45 px-2.5 py-1.5 rounded-full flex-row items-center gap-1.5">
                <FontAwesome6 name="images" size={11} colorClassName="accent-on-brand" />
                <Text className="text-[10px] font-bold text-white">{postImages.length} 张</Text>
              </View>
            </View>
          ) : (
            <View className="w-full min-h-64 bg-warm-soft p-6 justify-between overflow-hidden">
              <View className="absolute -right-10 -top-10 w-36 h-36 rounded-full bg-highlight/25" />
              <View className="absolute -left-12 -bottom-16 w-40 h-40 rounded-full bg-brand/10" />
              <View className="self-start flex-row items-center gap-2 bg-surface/65 px-3 py-1.5 rounded-full">
                <FontAwesome6 name="pen-nib" size={12} colorClassName="accent-brand" />
                <Text className="text-[11px] text-brand font-bold">#{post.category || "寻味"} · 文字笔记</Text>
              </View>
              <Text className="text-xl text-ink font-bold leading-8 tracking-wide">
                {post.content}
              </Text>
              <Text className="text-xs text-copy-muted font-semibold">
                {failedImageUrls.length ? "图片未能加载，已以文字笔记呈现" : "记录每一份轻盈与美味"}
              </Text>
            </View>
          )}

          {/* 文本内容与互动栏 */}
          <View className="p-5">
            {post.category === "活动" ? (
              <View className="mb-4 rounded-2xl border border-line bg-background-secondary p-4">
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center gap-2">
                    <FontAwesome6 name="calendar-check" size={14} colorClassName="accent-brand" />
                    <Text className="text-sm font-black text-brand">活动信息</Text>
                  </View>
                  <View className={`rounded-full px-2.5 py-1 ${activityEnded ? "bg-background-secondary" : "bg-brand-soft"}`}>
                    <Text className={`text-[9px] font-black ${activityEnded ? "text-copy-muted" : "text-brand"}`}>
                      {activityEnded ? "已结束" : "报名中"}
                    </Text>
                  </View>
                </View>
                <Text className="mt-3 text-xs font-semibold text-copy-muted">
                  {formatLocalPostDate(post.event_start_at)}—{formatLocalPostDate(post.event_end_at)}
                </Text>
                <View className="mt-3 flex-row items-center justify-between">
                  <Text className="text-[10px] text-copy-muted">{post.participant_count || 0} 位食友已参加</Text>
                  <TouchableOpacity
                    onPress={handleJoinEvent}
                    disabled={activityEnded}
                    className={`rounded-full px-4 py-2 ${activityEnded ? "bg-background-secondary" : post.is_joined ? "bg-brand-soft" : "bg-brand-fill"}`}
                  >
                    <Text className={`text-[10px] font-black ${activityEnded ? "text-copy-muted" : post.is_joined ? "text-brand" : "text-white"}`}>
                      {activityEnded ? "活动已结束" : post.is_joined ? "已参加 · 退出" : "立即参加"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : post.category === "问答" ? (
              <View className={`mb-4 flex-row items-center justify-between rounded-2xl border p-3.5 ${post.question_status === "resolved" ? "border-brand bg-brand-soft" : "border-warm bg-warm-soft"}`}>
                <View className="flex-row items-center gap-2">
                  <FontAwesome6 name={post.question_status === "resolved" ? "circle-check" : "circle-question"} size={15} colorClassName={post.question_status === "resolved" ? "accent-brand" : "accent-warm"} />
                  <View>
                    <Text className={`text-xs font-black ${post.question_status === "resolved" ? "text-brand" : "text-warm"}`}>
                      {post.question_status === "resolved" ? "问题已解决" : "等待优质回答"}
                    </Text>
                    <Text className="mt-0.5 text-[9px] text-copy-muted">已有 {post.comment_count || 0} 个回答 · {post.views_count || 0} 次浏览</Text>
                  </View>
                </View>
                {post.author_is_expert ? <Text className="text-[9px] font-black text-brand">专业用户提问</Text> : null}
              </View>
            ) : null}
            <Text className="text-base text-ink font-semibold leading-7 tracking-wide">
              {post.content}
            </Text>
            <LinkedRecipeCard
              recipe={post.linked_recipe}
              unavailable={post.linked_recipe_unavailable}
              onPress={() => post.linked_recipe && router.push("/recipe-detail", { id: post.linked_recipe.id })}
            />

            {/* 只展示发布时真实选择的分类，不由前端生成额外标签。 */}
            {post.category ? (
              <View className="flex-row mt-4">
                <View className="bg-brand/10 px-2.5 py-1 rounded-lg">
                  <Text className="text-[11px] font-bold text-brand">#{post.category}</Text>
                </View>
              </View>
            ) : null}

            {/* 发布时间与浏览量 */}
            <View className="mt-5 flex-row items-center gap-2 border-t border-background-secondary pt-4">
              <Text
                className="min-w-0 flex-1 text-[11px] text-copy-muted"
                numberOfLines={1}
                ellipsizeMode="tail"
                maxFontSizeMultiplier={1.2}
              >
                发布于 {formatLocalDateTime(post.created_at)} · {post.views_count || 0} 次浏览
              </Text>
              <Text
                className="shrink-0 text-[11px] font-bold text-brand"
                numberOfLines={1}
                maxFontSizeMultiplier={1.2}
              >
                IP: {post.ip_location || "属地未知"}
              </Text>
            </View>
          </View>

          {/* 分隔条 */}
          <View className="h-2 bg-background-secondary" />

          {/* 评论区标题 */}
          <View className="p-5 border-b border-background-secondary">
            <View className="flex-row items-center justify-between">
              <Text className="text-sm font-bold text-ink">
                {post.category === "问答" ? "全部回答" : "精彩评论"} ({post.comment_count ?? comments.length})
              </Text>
              <Text className="text-xs text-copy-muted">按热度排序</Text>
            </View>
          </View>

          {/* 评论列表 */}
          <View className="px-5">
            {comments.map((comment) => (
              <View
                key={comment.id}
                className={`flex-row gap-3 border-b py-3.5 ${comment.is_accepted ? "border-brand bg-brand-soft -mx-2 px-2" : "border-background-secondary"}`}
              >
                <Image
                  source={getAvatarSource(comment.avatar_url, comment.username)}
                  className="w-8 h-8 rounded-full"
                />
                <View className="flex-1">
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center gap-1.5">
                      <Text className="text-xs font-bold text-ink">{comment.username}</Text>
                      {comment.is_expert_answer ? (
                        <View className="rounded bg-brand-soft px-1.5 py-0.5">
                          <Text className="text-[8px] font-black text-brand">专业回答</Text>
                        </View>
                      ) : null}
                      {comment.is_accepted ? (
                        <View className="flex-row items-center gap-1 rounded bg-brand-fill px-1.5 py-0.5">
                          <FontAwesome6 name="check" size={7} colorClassName="accent-on-brand" />
                          <Text className="text-[8px] font-black text-white">已采纳</Text>
                        </View>
                      ) : null}
                    </View>
                    <TouchableOpacity
                      onPress={() => handleLikeComment(comment.id)}
                      className="flex-row items-center gap-1"
                    >
                      <FontAwesome6
                        name="heart"
                        size={11}
                        colorClassName={comment.is_liked ? "accent-critical" : "accent-copy-muted"}
                        solid={comment.is_liked}
                      />
                      <Text
                        className={`text-[10px] ${
                          comment.is_liked ? "text-critical" : "text-copy-muted"
                        }`}
                      >
                        {comment.likes_count}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <Text className="text-xs text-copy-muted mt-1.5 leading-5">
                    {comment.content}
                  </Text>

                  {comment.image_url ? (
                    <TouchableOpacity
                      onPress={() => setPreviewImageUrl(comment.image_url || null)}
                      activeOpacity={0.85}
                      className="mt-2 self-start"
                      accessibilityRole="button"
                      accessibilityLabel="查看评论图片大图"
                    >
                      <Image
                        source={{ uri: resolveMediaUrl(comment.image_url) }}
                        className="w-28 h-28 rounded-xl"
                        resizeMode="cover"
                      />
                    </TouchableOpacity>
                  ) : null}

                  <Text className="text-[10px] text-copy-muted mt-1">
                    {formatLocalDateTime(comment.created_at)}
                  </Text>
                  {post.category === "问答" && post.user_id === user?.id ? (
                    <TouchableOpacity
                      onPress={() => handleAcceptAnswer(comment.id)}
                      className={`mt-2 self-start rounded-full px-3 py-1.5 ${comment.is_accepted ? "bg-brand-soft" : "bg-background-secondary"}`}
                    >
                      <Text className={`text-[9px] font-black ${comment.is_accepted ? "text-brand" : "text-copy-muted"}`}>
                        {comment.is_accepted ? "取消采纳" : "采纳此回答"}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        </ScrollView>

        {/* 底部固定互动栏：输入入口保持轻量，点击后进入专注的评论面板。 */}
        <View
          className="absolute bottom-0 left-0 right-0 bg-surface border-t border-line px-4 pt-2.5 flex-row items-center gap-3 shadow-lg"
          style={{ paddingBottom: Math.max(insets.bottom, 10) }}
        >
          <TouchableOpacity
            onPress={openCommentComposer}
            className="flex-1 bg-background-secondary px-3.5 py-2.5 rounded-full flex-row items-center gap-2"
            accessibilityRole="button"
            accessibilityLabel="发布评论"
          >
            <FontAwesome6 name="pen-to-square" size={13} colorClassName="accent-copy-muted" />
            <Text className="flex-1 text-xs text-copy-muted">
              {post.category === "问答" ? "写下你的回答..." : "说点什么吧，与食友交流..."}
            </Text>
          </TouchableOpacity>

          {/* 点赞按钮 */}
          <TouchableOpacity
            onPress={handleLike}
            className="flex-row items-center gap-1 px-2.5 py-1.5"
          >
            <FontAwesome6
              name="heart"
              size={18}
              colorClassName={post.is_liked ? "accent-critical" : "accent-copy-muted"}
              solid={post.is_liked}
            />
            <Text
              className={`text-xs font-bold ${
                post.is_liked ? "text-critical" : "text-copy-muted"
              }`}
            >
              {post.likes_count}
            </Text>
          </TouchableOpacity>

          {/* 收藏按钮 */}
          <TouchableOpacity
            accessibilityLabel={bookmark.bookmarked ? "取消收藏帖子" : "收藏帖子"}
            accessibilityState={{ selected: bookmark.bookmarked, busy: bookmark.pending, disabled: isAuthenticated && (!bookmark.known || bookmark.pending || loading) }}
            disabled={isAuthenticated && (!bookmark.known || bookmark.pending || loading)}
            onPress={() => {
              if (!isAuthenticated) {
                promptForLogin("登录后收藏", "登录后即可收藏这篇分享。", "collect");
                return;
              }
              void bookmark.setBookmark().catch(() => {
                Alert.alert("收藏状态未确认", "请求未能确认完成，已尝试重新读取。请检查当前收藏状态后重试。");
              });
            }}
            className="px-2 py-1.5"
          >
            {bookmark.pending ? <ActivityIndicator size="small" /> : <FontAwesome6
              name="bookmark"
              size={17}
              colorClassName={bookmark.bookmarked ? "accent-highlight" : "accent-copy-muted"}
              solid={bookmark.bookmarked}
            />}
          </TouchableOpacity>
        </View>

        <Modal
          visible={isCommentComposerVisible}
          transparent
          animationType="fade"
          onRequestClose={closeCommentComposer}
          onShow={() => {
            setKeyboardTop(Keyboard.metrics()?.screenY ?? null);
            commentInputRef.current?.focus();
          }}
          statusBarTranslucent
          navigationBarTranslucent
        >
          <View
            onLayout={(event) => setComposerHeight(event.nativeEvent.layout.height)}
            className="flex-1 justify-end"
          >
            <TouchableOpacity
              activeOpacity={1}
              onPress={closeCommentComposer}
              className="absolute inset-0 bg-black/35"
              accessibilityRole="button"
              accessibilityLabel="关闭评论输入框"
            />

            <View
              className="bg-surface rounded-t-[28px] px-5 pt-4 shadow-2xl"
              style={{
                marginBottom: keyboardInset,
                maxHeight: effectiveViewportHeight > 0
                  ? Math.max(0, effectiveViewportHeight - keyboardInset - insets.top) : undefined,
                paddingBottom: keyboardInset > 0 ? 14 : Math.max(insets.bottom, 14),
              }}
            >
              <View className="w-10 h-1 rounded-full bg-background-secondary self-center mb-4" />
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-base font-bold text-ink">{post.category === "问答" ? "写回答" : "写评论"}</Text>
                <TouchableOpacity onPress={closeCommentComposer} className="min-h-touch min-w-touch items-center justify-center" accessibilityLabel="取消评论">
                  <Text className="text-sm text-copy-muted">取消</Text>
                </TouchableOpacity>
              </View>

              <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }}>
                <View className="h-32 max-h-32 rounded-2xl bg-background-secondary px-4 py-3 border border-line">
                  <TextInput
                    ref={commentInputRef}
                    value={commentText}
                    onChangeText={setCommentText}
                    placeholder="友善地说说你的想法吧..."
                    placeholderTextColorClassName="accent-copy-muted"
                    multiline
                    maxLength={300}
                    textAlignVertical="top"
                    className="flex-1 min-h-16 text-[15px] leading-6 text-ink"
                    accessibilityLabel="评论内容"
                  />
                  <Text className="self-end text-[11px] text-copy-muted mt-1">{commentText.length}/300</Text>
                </View>

                {commentImageUrl ? (
                  <View className="mt-3 self-start relative">
                    <Image source={{ uri: commentImageUrl }} className="w-20 h-20 rounded-xl" resizeMode="cover" />
                    <TouchableOpacity
                      onPress={() => setCommentImageUrl(null)}
                      className="absolute -right-2 -top-2 w-6 h-6 rounded-full bg-black/65 items-center justify-center"
                      accessibilityLabel="移除评论图片"
                    >
                      <FontAwesome6 name="xmark" size={11} colorClassName="accent-on-brand" />
                    </TouchableOpacity>
                  </View>
                ) : null}

                {isMentionPickerVisible ? (
                  <View className="mt-3 max-h-40 rounded-xl bg-background-secondary overflow-hidden border border-line">
                    <TextInput
                      value={mentionQuery}
                      onChangeText={(value) => {
                        setMentionQuery(value);
                        loadMentionUsers(value);
                      }}
                      placeholder="搜索用户"
                      placeholderTextColorClassName="accent-copy-muted"
                      autoFocus
                      className="px-3 py-2.5 text-sm text-ink border-b border-line"
                    />
                    <ScrollView keyboardShouldPersistTaps="handled">
                      {mentionUsers.map((user) => (
                        <TouchableOpacity
                          key={user.id}
                          onPress={() => selectMention(user)}
                          className="flex-row items-center gap-2.5 px-3 py-2"
                        >
                          <Image
                            source={getAvatarSource(user.avatar_url, user.id ?? user.username)}
                            className="w-7 h-7 rounded-full"
                          />
                          <View>
                            <Text className="text-xs font-bold text-ink">{user.username}</Text>
                            <Text className="text-[10px] text-copy-muted">@{user.username}</Text>
                          </View>
                        </TouchableOpacity>
                      ))}
                      {!mentionUsers.length ? <Text className="px-3 py-4 text-xs text-copy-muted">没有找到匹配的用户</Text> : null}
                  </ScrollView>
                </View>
              ) : null}

              {isEmojiPickerVisible ? (
                <View className="mt-3 flex-row flex-wrap gap-2 rounded-xl bg-background-secondary p-3 border border-line">
                  {EMOJI_OPTIONS.map((emoji, index) => (
                    <TouchableOpacity
                      key={`${emoji}-${index}`}
                      onPress={() => {
                        setCommentText((current) => `${current}${emoji}`);
                        commentInputRef.current?.focus();
                      }}
                      className="w-9 h-9 items-center justify-center rounded-lg bg-surface"
                      accessibilityLabel="插入表情"
                    >
                      <Text className="text-xl">{emoji}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}

              {!isAuthenticated ? (
                <View className="mt-3 flex-row items-center justify-between rounded-xl bg-warm-soft px-3 py-2.5">
                  <Text className="text-xs text-warm">登录后才能发布评论和 @ 食友</Text>
                  <TouchableOpacity onPress={() => { closeCommentComposer(); goToLogin("comment"); }}>
                    <Text className="text-xs font-bold text-brand">去登录</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              </ScrollView>
              <View className="flex-row items-center justify-between mt-3">
                <View className="flex-row items-center gap-1">
                  <TouchableOpacity onPress={pickCommentImage} className="w-10 h-10 items-center justify-center rounded-full active:bg-background-secondary" accessibilityLabel="添加图片">
                    <FontAwesome6 name="image" size={19} colorClassName="accent-copy-muted" />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={openMentionPicker} className="w-10 h-10 items-center justify-center rounded-full active:bg-background-secondary" accessibilityLabel="提及用户">
                    <FontAwesome6 name="at" size={19} colorClassName="accent-copy-muted" />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => { setIsEmojiPickerVisible((visible) => !visible); setIsMentionPickerVisible(false); }} className="w-10 h-10 items-center justify-center rounded-full active:bg-background-secondary" accessibilityLabel="选择表情">
                    <FontAwesome6 name="face-smile" size={20} colorClassName="accent-copy-muted" />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  onPress={handleAddComment}
                  disabled={submittingComment || !isAuthenticated || (!commentText.trim() && !commentImageUrl)}
                  className={`min-w-touch min-h-touch px-5 rounded-full items-center justify-center ${isAuthenticated && (commentText.trim() || commentImageUrl) ? "bg-brand-fill" : "bg-background-secondary"}`}
                  accessibilityRole="button"
                  accessibilityLabel="发送评论"
                  accessibilityState={{ disabled: submittingComment || !isAuthenticated || (!commentText.trim() && !commentImageUrl), busy: submittingComment }}
                >
                  {submittingComment ? <ActivityIndicator size="small" colorClassName="accent-on-brand" /> : <Text className="text-sm font-bold text-white">发送</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <Modal
          visible={!!previewImageUrl}
          transparent
          animationType="fade"
          onRequestClose={() => setPreviewImageUrl(null)}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => setPreviewImageUrl(null)}
            className="flex-1 bg-black/95 items-center justify-center px-4"
            accessibilityRole="button"
            accessibilityLabel="关闭图片预览"
          >
            {previewImageUrl ? (
              <Image source={{ uri: resolveMediaUrl(previewImageUrl) }} className="w-full h-[72%]" resizeMode="contain" />
            ) : null}
            <View className="absolute right-5 top-14 w-10 h-10 rounded-full bg-surface/20 items-center justify-center">
              <FontAwesome6 name="xmark" size={17} colorClassName="accent-on-brand" />
            </View>
            <Text className="absolute bottom-12 text-xs text-white/75">点击空白处关闭</Text>
          </TouchableOpacity>
        </Modal>
      </View>
    </Screen>
  );
}
