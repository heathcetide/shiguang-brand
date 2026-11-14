import {
  AdminButton,
  AdminField,
  AdminInput,
  AdminPagination,
  AdminSelect,
  ConfirmDialog,
  DialogFrame,
  EmptyState,
  FilterBar,
  PageHeader,
  StatusBadge,
  TableContainer,
} from '@/components/admin';
import { useQueryState } from '@/hooks/useQueryState';
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Search,
  Heart,
  Trash2,
  X,
  Eye,
  MessageCircle,
  Settings2,
  CalendarDays,
  Users,
  CircleCheck,
  BadgeCheck,
  Save,
  RotateCcw,
  HelpCircle,
  LayoutList,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import api from '@/services/api';
import { cn } from '@/utils/cn';
import { getAvatarUrl } from '@/utils/avatar';
import { asAdminPage } from '@/utils/adminResponses';

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

function eventStatusTone(status: string): 'success' | 'warning' | 'neutral' {
  if (status === '进行中') return 'success';
  if (status === '即将开始') return 'warning';
  return 'neutral';
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
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [total, setTotal] = useState(0);

  const fetchPosts = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/admin/community', {
        params: {
          page,
          pageSize,
          category: categoryFilter === '全部' ? undefined : categoryFilter,
          search: searchQuery.trim() || undefined,
        },
      });
      const pageData = asAdminPage<Post>(res.data, ['items', 'posts']);
      setPosts(pageData.items);
      setTotal(pageData.total);
    } catch (err) {
      console.error('Error fetching posts:', err);
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, page, searchQuery]);

  useEffect(() => {
    void fetchPosts();
  }, [fetchPosts]);

  const communityStats = useMemo(() => {
    const questions = posts.filter((p) => p.category === '问答').length;
    const events = posts.filter((p) => p.category === '活动').length;
    const totalComments = posts.reduce((sum, p) => sum + (p.comment_count || 0), 0);
    return { totalPosts: total, questions, events, totalComments };
  }, [posts, total]);

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
      const payload = res.data;
      const list = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.comments)
          ? payload.comments
          : Array.isArray(payload?.items)
            ? payload.items
            : [];
      setComments(list);
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

  const categories = ['全部', '寻味', '问答', '活动', ...Array.from(new Set(posts.map((p) => p.category).filter(Boolean)))];
  const uniqueCategories = Array.from(new Set(categories));
  const filteredPosts = posts;

  const statCards = [
    { label: '总帖子动态', value: communityStats.totalPosts, icon: LayoutList },
    { label: '社区问答帖', value: communityStats.questions, icon: HelpCircle },
    { label: '线上 / 线下活动', value: communityStats.events, icon: CalendarDays },
    { label: '社区评论互动', value: communityStats.totalComments, icon: MessageCircle },
  ] as const;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="社区管理"
        description="监管社区帖子交流、优质问答采纳、社区活动发布及评论合规审核"
      />
      <FilterBar>
        <AdminField label="搜索" className="min-w-[220px]">
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <AdminInput
              className="pl-9"
              placeholder="搜索帖子内容或用户名..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
            />
          </div>
        </AdminField>
        <AdminField label="分类">
          <AdminSelect value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}>
            {uniqueCategories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
          </AdminSelect>
        </AdminField>
      </FilterBar>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <Card key={stat.label} className="py-3">
            <CardContent className="flex items-center gap-3">
              <div className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-xl">
                <stat.icon className="size-5" aria-hidden />
              </div>
              <div>
                <p className="text-muted-foreground text-xs">{stat.label}</p>
                <p className="text-foreground text-xl font-semibold tracking-tight">
                  {loading ? '—' : stat.value}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {loading ? (
        <EmptyState>加载中...</EmptyState>
      ) : filteredPosts.length === 0 ? (
        <EmptyState>未找到相关帖子</EmptyState>
      ) : (
        <>
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="min-w-[160px]">作者</TableHead>
                  <TableHead className="min-w-[280px]">内容摘要</TableHead>
                  <TableHead className="min-w-[110px]">分类</TableHead>
                  <TableHead className="min-w-[140px]">业务状态</TableHead>
                  <TableHead className="min-w-[160px]">发布时间</TableHead>
                  <TableHead>浏览</TableHead>
                  <TableHead>点赞</TableHead>
                  <TableHead>评论</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPosts.map(post => (
                  <TableRow key={post.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <img src={getAvatarUrl(post.avatar_url, post.user_id)} alt={post.username} className="size-9 shrink-0 rounded-full object-cover" />
                        <div className="min-w-0">
                          <span className="text-foreground block max-w-28 truncate text-sm font-medium">{post.username}</span>
                          {post.author_is_expert ? (
                            <span className="text-success mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium whitespace-nowrap">
                              <BadgeCheck className="size-3" aria-hidden />
                              专业用户
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <button type="button" onClick={() => openPostManager(post)} className="text-foreground hover:text-primary block max-w-md text-left text-sm transition-colors">
                        <span className="line-clamp-2 leading-relaxed">{post.content}</span>
                      </button>
                      {post.image_url && (
                        <button type="button" onClick={() => setPreviewImage(post.image_url)} className="text-primary mt-1 inline-block text-xs font-medium hover:underline">
                          查看图片
                        </button>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{post.category || '寻味'}</Badge>
                    </TableCell>
                    <TableCell>
                      {post.category === '活动' ? (
                        <div className="space-y-1">
                          <StatusBadge tone={eventStatusTone(getEventStatus(post))}>{getEventStatus(post)}</StatusBadge>
                          <p className="text-muted-foreground text-[11px]">{post.participant_count || 0} 人参加</p>
                        </div>
                      ) : post.category === '问答' ? (
                        <div className="space-y-1">
                          <StatusBadge tone={post.question_status === 'resolved' ? 'success' : 'warning'}>
                            {post.question_status === 'resolved' ? '已解决' : '待解决'}
                          </StatusBadge>
                          <p className="text-muted-foreground text-[11px]">{post.comment_count || 0} 个回答</p>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                      {new Date(post.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>{post.views_count || 0}</TableCell>
                    <TableCell>{post.likes_count || 0}</TableCell>
                    <TableCell>
                      <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => openPostManager(post)}>
                        {post.comment_count || 0}
                      </Button>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1" onClick={() => openPostManager(post)}>
                          <Settings2 className="size-3.5" aria-hidden />
                          管理
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-destructive size-8"
                          onClick={() => setDeleteModal({ isOpen: true, postId: post.id })}
                          title="删除"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <AdminPagination page={page} pageSize={pageSize} total={total} disabled={loading} onChange={setPage} />
        </>
      )}

      {selectedPost && (
        <DialogFrame onClose={() => setSelectedPost(null)} busy={savingBusinessState} className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm">
          <aside className="bg-card border-border h-full w-full max-w-2xl overflow-y-auto border-l p-6 shadow-xl" onClick={event => event.stopPropagation()}>
            <div className="border-border flex items-center justify-between border-b pb-4">
              <div>
                <h2 className="text-foreground text-lg font-semibold">帖子管理</h2>
                <p className="text-muted-foreground mt-1 text-sm">#{selectedPost.id} · {selectedPost.username}</p>
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label="关闭" onClick={() => setSelectedPost(null)}>
                <X className="size-5" />
              </Button>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3">
              {[
                { icon: Eye, label: '浏览', value: selectedPost.views_count || 0 },
                { icon: Heart, label: '点赞', value: selectedPost.likes_count || 0 },
                { icon: MessageCircle, label: '评论', value: selectedPost.comment_count || 0 },
              ].map((item) => (
                <Card key={item.label} className="py-3">
                  <CardContent className="space-y-1">
                    <item.icon className="text-primary size-4" aria-hidden />
                    <p className="text-foreground text-xl font-semibold">{item.value}</p>
                    <p className="text-muted-foreground text-xs">{item.label}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
            {selectedPost.category === '活动' ? (
              <Card className="mt-5 gap-0 py-0">
                <CardContent className="space-y-4 py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CalendarDays className="text-foreground size-5" aria-hidden />
                      <h3 className="text-foreground font-semibold">活动管理</h3>
                    </div>
                    <StatusBadge tone={eventStatusTone(getEventStatus(selectedPost))}>{getEventStatus(selectedPost)}</StatusBadge>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <AdminField label="开始时间">
                      <AdminInput type="datetime-local" value={eventStartAt} onChange={(event) => setEventStartAt(event.target.value)} />
                    </AdminField>
                    <AdminField label="结束时间">
                      <AdminInput type="datetime-local" value={eventEndAt} onChange={(event) => setEventEndAt(event.target.value)} />
                    </AdminField>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground flex items-center gap-2 text-sm">
                      <Users className="size-4" aria-hidden />
                      {selectedPost.participant_count || 0} 位真实参与用户
                    </span>
                    <AdminButton onClick={() => void saveEventSchedule()} disabled={savingBusinessState} variant="primary">
                      <Save className="size-3.5" aria-hidden />
                      保存时间
                    </AdminButton>
                  </div>
                </CardContent>
              </Card>
            ) : selectedPost.category === '问答' ? (
              <Card className="mt-5 gap-0 py-0">
                <CardContent className="space-y-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <CircleCheck className={cn('size-5', selectedPost.question_status === 'resolved' ? 'text-success' : 'text-warning')} aria-hidden />
                      <div>
                        <h3 className="text-foreground font-semibold">问答状态</h3>
                        <p className="text-muted-foreground text-xs">{selectedPost.comment_count || 0} 个真实回答</p>
                      </div>
                    </div>
                    <StatusBadge tone={selectedPost.question_status === 'resolved' ? 'success' : 'warning'}>
                      {selectedPost.question_status === 'resolved' ? '已解决' : '待解决'}
                    </StatusBadge>
                  </div>
                  {selectedPost.question_status === 'resolved' ? (
                    <AdminButton onClick={() => void updateQuestionState(null)} disabled={savingBusinessState}>
                      <RotateCcw className="size-3.5" aria-hidden />
                      重新打开问题
                    </AdminButton>
                  ) : (
                    <p className="text-muted-foreground text-xs leading-5">请在下方回答列表中选择一条合适的回复作为采纳答案。</p>
                  )}
                </CardContent>
              </Card>
            ) : null}
            <Card className="mt-5 gap-0 py-0">
              <CardContent className="py-4">
                <p className="text-muted-foreground mb-2 text-xs font-medium">帖子内容</p>
                <p className="text-foreground whitespace-pre-wrap text-sm leading-7">{selectedPost.content}</p>
                {selectedPost.image_url && (
                  <img src={selectedPost.image_url} alt="" className="mt-4 max-h-72 w-full rounded-xl object-cover ring-1 ring-foreground/10" />
                )}
              </CardContent>
            </Card>
            <div className="mt-6 flex items-center justify-between">
              <h3 className="text-foreground text-base font-semibold">
                {selectedPost.category === '问答' ? '回答管理' : '评论管理'}
              </h3>
              <span className="text-muted-foreground text-sm">{comments.length} 条</span>
            </div>
            {commentsLoading ? (
              <p className="text-muted-foreground py-10 text-center text-sm">加载评论中...</p>
            ) : !Array.isArray(comments) || comments.length === 0 ? (
              <p className="text-muted-foreground py-10 text-center text-sm">暂无评论</p>
            ) : (
              <div className="divide-border mt-3 divide-y">
                {comments.map(comment => (
                  <div key={comment.id} className={cn('flex gap-3 py-4', comment.is_accepted && 'bg-success/5 -mx-2 rounded-lg px-2')}>
                    <img src={getAvatarUrl(comment.avatar_url, comment.username)} alt={comment.username} className="size-8 shrink-0 rounded-full object-cover" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-foreground text-sm font-medium">{comment.username}</span>
                        {comment.is_expert_answer ? (
                          <Badge variant="success" className="gap-1">
                            <BadgeCheck className="size-3" aria-hidden />
                            专业回答
                          </Badge>
                        ) : null}
                        {comment.is_accepted ? <Badge variant="default">已采纳</Badge> : null}
                      </div>
                      <p className="text-muted-foreground mt-1 text-sm leading-6 break-words">{comment.content}</p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {comment.likes_count || 0} 赞 · {new Date(comment.created_at).toLocaleString()}
                      </p>
                      {selectedPost.category === '问答' ? (
                        <Button
                          type="button"
                          variant={comment.is_accepted ? 'outline' : 'secondary'}
                          size="sm"
                          className="mt-2 h-8"
                          onClick={() => void updateQuestionState(comment.id)}
                          disabled={savingBusinessState}
                        >
                          {comment.is_accepted ? '取消采纳' : '设为采纳回答'}
                        </Button>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive size-8 shrink-0"
                      onClick={() => deleteComment(comment.id)}
                      title="删除评论"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </aside>
        </DialogFrame>
      )}

      <Dialog open={Boolean(previewImage)} onOpenChange={(open) => { if (!open) setPreviewImage(null); }}>
        <DialogContent className="max-w-5xl border-0 bg-transparent p-0 shadow-none" showClose={false}>
          <div className="relative flex items-center justify-center">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              aria-label="关闭"
              className="absolute top-2 right-2 z-10 rounded-full"
              onClick={() => setPreviewImage(null)}
            >
              <X className="size-5" />
            </Button>
            {previewImage ? (
              <img
                src={previewImage}
                alt="Preview"
                className="max-h-[90vh] max-w-full rounded-lg object-contain"
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      {deleteModal ? (
        <ConfirmDialog
          title="确认删除"
          description="确定要将这条帖子移入回收站吗？之后可在「安全审计」中恢复。"
          onCancel={() => setDeleteModal(null)}
          onConfirm={() => handleDelete(deleteModal.postId)}
        />
      ) : null}
    </div>
  );
}