import { DialogFrame } from '../components/admin/DialogFrame';
import { useQueryState } from '../hooks/useQueryState';
import { useState, useEffect, useMemo } from 'react';
import { Search, Heart, Trash2, AlertCircle, X, Eye, MessageCircle, Settings2, CalendarDays, Users, CircleCheck, BadgeCheck, Save, RotateCcw, HelpCircle, Sparkles } from 'lucide-react';
import api from '../services/api';
import { cn } from '../utils/cn';
import { getAvatarUrl } from '../utils/avatar';

interface Post {
  id: number;
  user_id: number;
  username: string;
  avatar_url: string;
  category: string;
  content: string;
  image_url: string;
  likes_count: number;
  views_count: number;
  comment_count: number;
  event_start_at?: string | null;
  event_end_at?: string | null;
  participant_count?: number;
  question_status?: 'open' | 'resolved' | null;
  accepted_comment_id?: number | null;
  author_is_expert?: number | boolean;
  created_at: string;
}

interface CommentItem {
  id: number;
  username: string;
  avatar_url: string;
  content: string;
  likes_count: number;
  is_expert_answer?: number | boolean;
  is_accepted?: number | boolean;
  created_at: string;
}

export default function Community() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useQueryState<string>('q', '');
  const [categoryFilter, setCategoryFilter] = useQueryState<string>('category', '全部');
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [eventStartAt, setEventStartAt] = useState('');
  const [eventEndAt, setEventEndAt] = useState('');
  const [savingBusinessState, setSavingBusinessState] = useState(false);

  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    postId: number;
  } | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  useEffect(() => {
    fetchPosts();
  }, []);

  const fetchPosts = async (cursor?: string) => {
    try {
      setLoading(true);
      const res = await api.get('/admin/community', { params: { pageSize: 50, cursor } });
      setPosts(current => cursor ? [...current, ...res.data.items.filter((item: Post) => !current.some(existing => existing.id === item.id))] : res.data.items);
      setNextCursor(res.data.nextCursor);
    } catch (err) {
      console.error('Error fetching posts:', err);
    } finally {
      setLoading(false);
    }
  };

  const communityStats = useMemo(() => {
    const totalPosts = posts.length;
    const questions = posts.filter(p => p.category === '问答').length;
    const events = posts.filter(p => p.category === '活动').length;
    const totalComments = posts.reduce((sum, p) => sum + (p.comment_count || 0), 0);
    return { totalPosts, questions, events, totalComments };
  }, [posts]);

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/admin/community/${id}`);
      setPosts(posts.filter(p => p.id !== id));
      setDeleteModal(null);
    } catch (err) {
      console.error('Error deleting post:', err);
    }
  };

  const openPostManager = async (post: Post) => {
    setSelectedPost(post);
    setEventStartAt(post.event_start_at?.slice(0, 16).replace(' ', 'T') || '');
    setEventEndAt(post.event_end_at?.slice(0, 16).replace(' ', 'T') || '');
    setCommentsLoading(true);
    try {
      const res = await api.get(`/admin/community/${post.id}/comments`);
      setComments(res.data);
    } catch (err) {
      console.error('Error fetching comments:', err);
      setComments([]);
    } finally {
      setCommentsLoading(false);
    }
  };

  const deleteComment = async (commentId: number) => {
    try {
      const deletedComment = comments.find(comment => comment.id === commentId);
      await api.delete(`/admin/community/comments/${commentId}`);
      setComments(current => current.filter(comment => comment.id !== commentId));
      setPosts(current => current.map(post => post.id === selectedPost?.id ? {
        ...post,
        comment_count: Math.max((post.comment_count || 0) - 1, 0),
        ...(deletedComment?.is_accepted ? { accepted_comment_id: null, question_status: 'open' as const } : {}),
      } : post));
      setSelectedPost(current => current ? {
        ...current,
        comment_count: Math.max((current.comment_count || 0) - 1, 0),
        ...(current.accepted_comment_id === commentId ? { accepted_comment_id: null, question_status: 'open' as const } : {}),
      } : current);
    } catch (err) {
      console.error('Error deleting comment:', err);
    }
  };

  const saveEventSchedule = async () => {
    if (!selectedPost || selectedPost.category !== '活动') return;
    try {
      setSavingBusinessState(true);
      const res = await api.put(`/admin/community/${selectedPost.id}/event`, {
        event_start_at: eventStartAt,
        event_end_at: eventEndAt,
      });
      const update = {
        event_start_at: res.data.event_start_at as string,
        event_end_at: res.data.event_end_at as string,
      };
      setSelectedPost(current => current ? { ...current, ...update } : current);
      setPosts(current => current.map(post => post.id === selectedPost.id ? { ...post, ...update } : post));
    } catch (err) {
      console.error('Error updating event schedule:', err);
    } finally {
      setSavingBusinessState(false);
    }
  };

  const updateQuestionState = async (acceptedCommentId: number | null) => {
    if (!selectedPost || selectedPost.category !== '问答') return;
    const isClearing = acceptedCommentId === null || selectedPost.accepted_comment_id === acceptedCommentId;
    try {
      setSavingBusinessState(true);
      const res = await api.put(`/admin/community/${selectedPost.id}/question`, {
        question_status: isClearing ? 'open' : 'resolved',
        accepted_comment_id: isClearing ? null : acceptedCommentId,
      });
      const update = {
        question_status: res.data.question_status as 'open' | 'resolved',
        accepted_comment_id: res.data.accepted_comment_id as number | null,
      };
      setSelectedPost(current => current ? { ...current, ...update } : current);
      setPosts(current => current.map(post => post.id === selectedPost.id ? { ...post, ...update } : post));
      setComments(current => current.map(comment => ({ ...comment, is_accepted: comment.id === update.accepted_comment_id })));
    } catch (err) {
      console.error('Error updating question status:', err);
    } finally {
      setSavingBusinessState(false);
    }
  };

  const getEventStatus = (post: Post) => {
    const now = Date.now();
    const start = post.event_start_at ? new Date(post.event_start_at.replace(' ', 'T')).getTime() : null;
    const end = post.event_end_at ? new Date(post.event_end_at.replace(' ', 'T')).getTime() : null;
    if (start && start > now) return '即将开始';
    if (end && end < now) return '已结束';
    return '进行中';
  };

  const categories = ['全部', ...Array.from(new Set(posts.map(p => p.category).filter(Boolean)))];

  const filteredPosts = posts.filter(post => {
    const matchesSearch =
      post.content?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      post.username?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      post.username.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory =
      categoryFilter === '全部' ? true : post.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-main flex items-center gap-2">
            <MessageCircle className="w-7 h-7 text-primary" />
            社区管理
          </h1>
          <p className="text-xs text-text-muted mt-1">监管社区帖子交流、优质问答采纳、社区活动发布及评论合规审核</p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted w-4 h-4" />
          <input
            type="text"
            placeholder="搜索已加载记录：帖子内容或用户名..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white rounded-xl text-sm border border-gray-100 focus:ring-2 focus:ring-primary/20 outline-none shadow-sm"
          />
        </div>
      </div>

      {/* Top Metric Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex items-center justify-between rounded-[24px] bg-white p-5 shadow-sm">
          <div>
            <p className="text-xs font-medium text-text-muted">总帖子动态</p>
            <p className="mt-1.5 text-2xl font-bold text-text-main">{loading ? '—' : communityStats.totalPosts}</p>
          </div>
          <div className="rounded-2xl bg-primary/10 p-3 text-primary">
            <Sparkles className="h-6 w-6" />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-[24px] bg-white p-5 shadow-sm">
          <div>
            <p className="text-xs font-medium text-text-muted">社区问答帖</p>
            <p className="mt-1.5 text-2xl font-bold text-blue-600">{loading ? '—' : communityStats.questions}</p>
          </div>
          <div className="rounded-2xl bg-blue-50 p-3 text-blue-600">
            <HelpCircle className="h-6 w-6" />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-[24px] bg-white p-5 shadow-sm">
          <div>
            <p className="text-xs font-medium text-text-muted">线上 / 线下活动</p>
            <p className="mt-1.5 text-2xl font-bold text-emerald-600">{loading ? '—' : communityStats.events}</p>
          </div>
          <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-600">
            <CalendarDays className="h-6 w-6" />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-[24px] bg-white p-5 shadow-sm">
          <div>
            <p className="text-xs font-medium text-text-muted">社区评论互动</p>
            <p className="mt-1.5 text-2xl font-bold text-secondary">{loading ? '—' : communityStats.totalComments}</p>
          </div>
          <div className="rounded-2xl bg-secondary/10 p-3 text-secondary">
            <MessageCircle className="h-6 w-6" />
          </div>
        </div>
      </div>

      {categories.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          {categories.map(cat => {
            const count = cat === '全部' ? posts.length : posts.filter(p => p.category === cat).length;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={cn(
                  "px-4 py-2 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 shadow-sm",
                  categoryFilter === cat
                    ? "bg-primary text-white"
                    : "bg-white text-text-muted hover:text-text-main border border-gray-100"
                )}
              >
                <span>{cat}</span>
                <span className={cn(
                  "rounded-full px-1.5 py-0.2 text-[10px]",
                  categoryFilter === cat ? "bg-white/20 text-white" : "bg-background-alt text-text-muted"
                )}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-text-muted">加载中...</div>
      ) : filteredPosts.length === 0 ? (
        <div className="py-12 text-center text-text-muted bg-white rounded-[24px] shadow-sm">未找到相关帖子</div>
      ) : (
        <><div className="hidden">
          {filteredPosts.map(post => (
            <div key={post.id} className="bg-white rounded-[24px] shadow-sm overflow-hidden flex flex-col hover:shadow-md transition-shadow">
              <div className="p-5 flex items-center justify-between border-b border-background-alt/50">
                <div className="flex items-center gap-3">
                  <img
                    src={getAvatarUrl(post.avatar_url, post.user_id)}
                    alt={post.username}
                    className="w-10 h-10 rounded-full object-cover"
                  />
                  <div>
                    <div className="font-medium text-sm text-text-main truncate max-w-[120px]">
                      {post.username}
                    </div>
                    <div className="text-xs text-text-muted">
                      {new Date(post.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                {post.category && (
                  <span className="px-2.5 py-1 bg-background text-primary text-xs font-medium rounded-lg">
                    {post.category}
                  </span>
                )}
              </div>

              <div className="p-5 flex-1">
                <p className="text-sm text-text-main mb-4 line-clamp-3 leading-relaxed">
                  {post.content}
                </p>
                {post.image_url && (
                  <div
                    className="relative rounded-2xl overflow-hidden aspect-video cursor-pointer group bg-background-alt"
                    onClick={() => setPreviewImage(post.image_url)}
                  >
                    <img
                      src={post.image_url}
                      alt="Post content"
                      className="w-full h-full object-cover transition-transform group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                      <Search className="text-white opacity-0 group-hover:opacity-100 w-6 h-6" />
                    </div>
                  </div>
                )}
              </div>

              <div className="p-4 bg-background-alt/30 flex items-center justify-between">
                <div className="flex gap-4 text-text-muted">
                  <div className="flex items-center gap-1.5 text-sm font-medium" title="浏览次数">
                    <Eye className="w-4 h-4" />
                    {post.views_count || 0}
                  </div>
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <Heart className="w-4 h-4 text-secondary/70" />
                    {post.likes_count || 0}
                  </div>
                  <button onClick={() => openPostManager(post)} className="flex items-center gap-1.5 rounded-lg px-1 text-sm font-medium hover:text-primary" title="管理评论">
                    <MessageCircle className="w-4 h-4" />
                    {post.comment_count || 0}
                  </button>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => openPostManager(post)} className="flex items-center gap-1 rounded-xl px-2.5 py-2 text-xs font-medium text-primary hover:bg-primary/10" title="管理帖子"><Settings2 className="h-4 w-4" />管理</button>
                  <button onClick={() => setDeleteModal({ isOpen: true, postId: post.id })} className="p-2 text-text-muted hover:bg-red-50 hover:text-red-500 rounded-xl transition-colors" title="删除"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="overflow-hidden rounded-[24px] border border-background-alt bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left border-collapse">
              <thead className="border-b border-background-alt bg-[#FAFBFA] text-xs text-text-muted">
                <tr>
                  <th className="px-5 py-4 font-medium min-w-[160px] whitespace-nowrap">作者</th>
                  <th className="px-4 py-4 font-medium min-w-[280px]">内容摘要</th>
                  <th className="px-4 py-4 font-medium min-w-[110px] whitespace-nowrap">分类</th>
                  <th className="px-4 py-4 font-medium min-w-[140px] whitespace-nowrap">业务状态</th>
                  <th className="px-4 py-4 font-medium min-w-[160px] whitespace-nowrap">发布时间</th>
                  <th className="px-4 py-4 font-medium min-w-[80px] whitespace-nowrap">浏览</th>
                  <th className="px-4 py-4 font-medium min-w-[80px] whitespace-nowrap">点赞</th>
                  <th className="px-4 py-4 font-medium min-w-[80px] whitespace-nowrap">评论</th>
                  <th className="px-5 py-4 text-right font-medium min-w-[120px] whitespace-nowrap">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-background-alt">
                {filteredPosts.map(post => (
                  <tr key={post.id} className="hover:bg-[#FCFDFB] transition-colors">
                    <td className="px-5 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <img src={getAvatarUrl(post.avatar_url, post.user_id)} alt={post.username} className="h-9 w-9 rounded-full object-cover shrink-0" />
                        <div className="min-w-0">
                          <span className="block max-w-28 truncate text-sm font-medium text-text-main">{post.username}</span>
                          {post.author_is_expert ? <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium text-green-700 whitespace-nowrap"><BadgeCheck className="h-3 w-3" />专业用户</span> : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => openPostManager(post)} className="max-w-md text-left text-sm text-text-main hover:text-primary transition-colors block">
                        <span className="line-clamp-2 leading-relaxed">{post.content}</span>
                      </button>
                      {post.image_url && <button onClick={() => setPreviewImage(post.image_url)} className="mt-1 inline-block text-xs text-primary hover:underline font-medium">查看图片</button>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-block whitespace-nowrap rounded-lg bg-background px-2.5 py-1 text-xs font-medium text-primary border border-primary/10">
                        {post.category || '寻味'}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {post.category === '活动' ? (
                        <div className="whitespace-nowrap">
                          <span className={cn('inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium', getEventStatus(post) === '进行中' ? 'bg-green-50 text-green-700 border border-green-100' : getEventStatus(post) === '即将开始' ? 'bg-amber-50 text-amber-700 border border-amber-100' : 'bg-gray-100 text-gray-600')}>{getEventStatus(post)}</span>
                          <div className="mt-1 text-[11px] text-text-muted whitespace-nowrap">{post.participant_count || 0} 人参加</div>
                        </div>
                      ) : post.category === '问答' ? (
                        <div className="whitespace-nowrap">
                          <span className={cn('inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium', post.question_status === 'resolved' ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-amber-50 text-amber-700 border border-amber-100')}>{post.question_status === 'resolved' ? '已解决' : '待解决'}</span>
                          <div className="mt-1 text-[11px] text-text-muted whitespace-nowrap">{post.comment_count || 0} 个回答</div>
                        </div>
                      ) : <span className="text-xs text-text-muted whitespace-nowrap">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-text-muted whitespace-nowrap">{new Date(post.created_at).toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-text-main whitespace-nowrap">{post.views_count || 0}</td>
                    <td className="px-4 py-3 text-sm text-text-main whitespace-nowrap">{post.likes_count || 0}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button onClick={() => openPostManager(post)} className="rounded-lg px-2.5 py-1 text-sm font-medium text-primary hover:bg-primary/10 transition-colors">
                        {post.comment_count || 0}
                      </button>
                    </td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      <div className="flex justify-end items-center gap-1">
                        <button onClick={() => openPostManager(post)} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors">
                          <Settings2 className="h-3.5 w-3.5" />管理
                        </button>
                        <button onClick={() => setDeleteModal({ isOpen: true, postId: post.id })} className="rounded-lg p-1.5 text-text-muted hover:bg-red-50 hover:text-red-500 transition-colors" title="删除">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {nextCursor ? <div className="border-t border-background-alt p-4 text-center"><button type="button" onClick={() => void fetchPosts(nextCursor)} disabled={loading} className="rounded-xl border border-background-alt px-4 py-2 text-xs font-semibold text-primary disabled:opacity-50">加载更多帖子</button></div> : null}
        </div></>
      )}

      {selectedPost && (
        <DialogFrame onClose={()=>setSelectedPost(null)} busy={savingBusinessState} className="fixed inset-0 z-50 flex justify-end bg-black/35 backdrop-blur-sm" >
          <aside className="h-full w-full max-w-2xl overflow-y-auto bg-white p-7 shadow-2xl" onClick={event => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-background-alt pb-5">
              <div><h2 className="text-xl font-bold text-text-main">帖子管理</h2><p className="mt-1 text-sm text-text-muted">#{selectedPost.id} · {selectedPost.username}</p></div>
              <button aria-label="关闭" onClick={() => setSelectedPost(null)} className="rounded-xl p-2 text-text-muted hover:bg-background-alt"><X className="h-5 w-5" /></button>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-3">
              <div className="rounded-2xl bg-background p-4"><Eye className="h-4 w-4 text-primary" /><div className="mt-2 text-xl font-bold text-text-main">{selectedPost.views_count || 0}</div><div className="text-xs text-text-muted">浏览</div></div>
              <div className="rounded-2xl bg-background p-4"><Heart className="h-4 w-4 text-secondary" /><div className="mt-2 text-xl font-bold text-text-main">{selectedPost.likes_count || 0}</div><div className="text-xs text-text-muted">点赞</div></div>
              <div className="rounded-2xl bg-background p-4"><MessageCircle className="h-4 w-4 text-primary" /><div className="mt-2 text-xl font-bold text-text-main">{selectedPost.comment_count || 0}</div><div className="text-xs text-text-muted">评论</div></div>
            </div>
            {selectedPost.category === '活动' ? (
              <div className="mt-6 rounded-2xl border border-green-200 bg-green-50/60 p-4">
                <div className="flex items-center justify-between"><div className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-green-700" /><h3 className="font-bold text-text-main">活动管理</h3></div><span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-green-700">{getEventStatus(selectedPost)}</span></div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <label className="text-xs text-text-muted">开始时间<input type="datetime-local" value={eventStartAt} onChange={event => setEventStartAt(event.target.value)} className="mt-1.5 w-full rounded-xl border border-green-200 bg-white px-3 py-2 text-sm text-text-main outline-none focus:ring-2 focus:ring-green-200" /></label>
                  <label className="text-xs text-text-muted">结束时间<input type="datetime-local" value={eventEndAt} onChange={event => setEventEndAt(event.target.value)} className="mt-1.5 w-full rounded-xl border border-green-200 bg-white px-3 py-2 text-sm text-text-main outline-none focus:ring-2 focus:ring-green-200" /></label>
                </div>
                <div className="mt-4 flex items-center justify-between"><div className="flex items-center gap-2 text-sm text-green-800"><Users className="h-4 w-4" />{selectedPost.participant_count || 0} 位真实参与用户</div><button onClick={() => void saveEventSchedule()} disabled={savingBusinessState} className="inline-flex items-center gap-1.5 rounded-xl bg-green-700 px-4 py-2 text-xs font-medium text-white disabled:opacity-50"><Save className="h-3.5 w-3.5" />保存时间</button></div>
              </div>
            ) : selectedPost.category === '问答' ? (
              <div className={cn('mt-6 rounded-2xl border p-4', selectedPost.question_status === 'resolved' ? 'border-green-200 bg-green-50/60' : 'border-amber-200 bg-amber-50/60')}>
                <div className="flex items-center justify-between"><div className="flex items-center gap-2"><CircleCheck className={cn('h-5 w-5', selectedPost.question_status === 'resolved' ? 'text-green-700' : 'text-amber-700')} /><div><h3 className="font-bold text-text-main">问答状态</h3><p className="mt-0.5 text-xs text-text-muted">{selectedPost.comment_count || 0} 个真实回答</p></div></div><span className={cn('rounded-full px-3 py-1 text-xs font-medium', selectedPost.question_status === 'resolved' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700')}>{selectedPost.question_status === 'resolved' ? '已解决' : '待解决'}</span></div>
                {selectedPost.question_status === 'resolved' ? <button onClick={() => void updateQuestionState(null)} disabled={savingBusinessState} className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-medium text-amber-700 shadow-sm disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" />重新打开问题</button> : <p className="mt-4 text-xs leading-5 text-text-muted">请在下方回答列表中选择一条合适的回复作为采纳答案。</p>}
              </div>
            ) : null}
            <div className="mt-6 rounded-2xl border border-background-alt p-4"><div className="mb-2 text-xs font-medium text-text-muted">帖子内容</div><p className="whitespace-pre-wrap text-sm leading-7 text-text-main">{selectedPost.content}</p>{selectedPost.image_url && <img src={selectedPost.image_url} alt="" className="mt-4 max-h-72 w-full rounded-xl object-cover" />}</div>
            <div className="mt-7 flex items-center justify-between"><h3 className="text-base font-bold text-text-main">{selectedPost.category === '问答' ? '回答管理' : '评论管理'}</h3><span className="text-sm text-text-muted">{comments.length} 条</span></div>
            {commentsLoading ? <div className="py-10 text-center text-sm text-text-muted">加载评论中...</div> : comments.length === 0 ? <div className="py-10 text-center text-sm text-text-muted">暂无评论</div> : <div className="mt-3 divide-y divide-background-alt">{comments.map(comment => <div key={comment.id} className={cn('flex gap-3 py-4', comment.is_accepted && 'rounded-xl bg-green-50 px-3')}><img src={getAvatarUrl(comment.avatar_url, comment.username)} alt={comment.username} className="h-8 w-8 shrink-0 rounded-full object-cover" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5"><span className="text-sm font-medium text-text-main">{comment.username}</span>{comment.is_expert_answer ? <span className="inline-flex items-center gap-1 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700"><BadgeCheck className="h-3 w-3" />专业回答</span> : null}{comment.is_accepted ? <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-white">已采纳</span> : null}</div><p className="mt-1 break-words text-sm leading-6 text-text-muted">{comment.content}</p><div className="mt-1 text-xs text-text-muted">{comment.likes_count || 0} 赞 · {new Date(comment.created_at).toLocaleString()}</div>{selectedPost.category === '问答' ? <button onClick={() => void updateQuestionState(comment.id)} disabled={savingBusinessState} className={cn('mt-2 rounded-lg px-2.5 py-1.5 text-xs font-medium disabled:opacity-50', comment.is_accepted ? 'bg-green-100 text-green-700' : 'bg-background-alt text-primary')}>{comment.is_accepted ? '取消采纳' : '设为采纳回答'}</button> : null}</div><button onClick={() => deleteComment(comment.id)} className="h-8 w-8 shrink-0 rounded-lg text-text-muted hover:bg-red-50 hover:text-red-500" title="删除评论"><Trash2 className="mx-auto h-4 w-4" /></button></div>)}</div>}
          </aside>
        </DialogFrame>
      )}

      {/* Image Preview Modal */}
      {previewImage && (
        <DialogFrame onClose={()=>setPreviewImage(null)} busy={false}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"

        >
          <div className="relative max-w-5xl max-h-screen w-full flex items-center justify-center">
            <button aria-label="关闭"
              onClick={() => setPreviewImage(null)}
              className="absolute top-4 right-4 p-2 bg-black/50 hover:bg-black/70 text-white rounded-full transition-colors z-10"
            >
              <X className="w-6 h-6" />
            </button>
            <img
              src={previewImage}
              alt="Preview"
              className="max-w-full max-h-[90vh] object-contain rounded-lg"
              onClick={e => e.stopPropagation()}
            />
          </div>
        </DialogFrame>
      )}

      {/* Delete Confirm Modal */}
      {deleteModal && (
        <DialogFrame onClose={()=>setDeleteModal(null)} busy={false} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-xl">
            <div className="flex items-center gap-3 text-red-500 mb-4">
              <AlertCircle className="w-6 h-6" />
              <h3 className="text-lg font-bold text-text-main">确认删除</h3>
            </div>
            <p className="text-text-muted text-sm mb-6">
              确定要将这条帖子移入回收站吗？之后可在“安全审计”中恢复。
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteModal(null)}
                className="flex-1 py-2.5 rounded-xl bg-background-alt text-text-main font-medium text-sm hover:bg-background-alt/80 transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => handleDelete(deleteModal.postId)}
                className="flex-1 py-2.5 rounded-xl bg-red-500 text-white font-medium text-sm hover:bg-red-600 transition-colors"
              >
                移入回收站
              </button>
            </div>
          </div>
        </DialogFrame>
      )}
    </div>
  );
}
