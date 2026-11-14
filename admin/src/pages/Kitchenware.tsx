import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { CookingPot, Pencil, Plus, Search, Trash2, UserRound, Wrench } from 'lucide-react'
import { DialogFrame } from '@/components/admin'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useQueryState } from '@/hooks/useQueryState'
import api from '@/services/api'
import { asAdminPage } from '@/utils/adminResponses'
import { cn } from '@/utils/cn'
import KitchenwareCapabilities from './KitchenwareCapabilities'

interface KitchenwareItem {
  id: number
  user_id: number
  name: string
  category: string
  status: string
  note: string | null
  image_url: string | null
  purchase_date: string | null
  last_maintained_at: string | null
  created_at: string
  owner_username: string
}

interface KitchenwareCatalogItem {
  id: number
  name: string
  category: string
  aliases?: string | null
  cooking_methods?: string | null
  care_note?: string | null
  image_url?: string | null
  description?: string | null
  source?: string | null
}

const DEFAULT_CATEGORIES = ['全部', '小家电', '烹饪锅具', '刀具餐具', '烘焙工具', '烹饪电器', '锅具与烘焙器具', '刀具与手动工具', '餐具与食物容器', '其他']
const statuses = ['全部', '常用', '良好', '需保养', '维修中', '闲置']

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Date(`${value.replace(' ', 'T')}Z`).toLocaleDateString('zh-CN')
}

function parseListJson(raw?: string | null) {
  if (!raw) return [] as string[]
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return raw.split(/[、,，]/).map((part) => part.trim()).filter(Boolean)
  }
}

function statusBadgeVariant(status: string) {
  if (status === '需保养' || status === '维修中') return 'warning' as const
  if (status === '闲置') return 'secondary' as const
  if (status === '常用') return 'success' as const
  return 'outline' as const
}

function Thumb({ src, alt }: { src?: string | null; alt: string }) {
  if (src) {
    return <img src={src} alt={alt} className="size-11 rounded-xl object-cover ring-1 ring-foreground/10" />
  }
  return (
    <div className="bg-primary/10 text-primary flex size-11 items-center justify-center rounded-xl">
      <CookingPot className="size-5" />
    </div>
  )
}

export default function Kitchenware() {
  const [capabilityItem, setCapabilityItem] = useState<KitchenwareCatalogItem | null>(null)
  const [activeTab, setActiveTab] = useQueryState<'catalog' | 'assets'>('tab', 'catalog', ['catalog', 'assets'])
  const [items, setItems] = useState<KitchenwareItem[]>([])
  const [catalog, setCatalog] = useState<KitchenwareCatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useQueryState<string>('q', '')
  const [category, setCategory] = useQueryState<string>('category', '全部')
  const [status, setStatus] = useQueryState<string>('status', '全部', statuses)
  const [message, setMessage] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 50
  const [total, setTotal] = useState(0)
  const pendingSave = useRef<symbol | null>(null)
  const [savingCatalog, setSavingCatalog] = useState(false)
  const [catalogSaveError, setCatalogSaveError] = useState('')
  const [catalogModalOpen, setCatalogModalOpen] = useState(false)
  const [editingCatalogItem, setEditingCatalogItem] = useState<KitchenwareCatalogItem | null>(null)
  const [catalogForm, setCatalogForm] = useState({
    name: '',
    category: '其他',
    aliases: '',
    cookingMethods: '',
    careNote: '',
    imageUrl: '',
  })

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true)
      const response = await api.get('/admin/kitchenware', {
        params: {
          search: search.trim() || undefined,
          category,
          status,
          page,
          pageSize,
        },
      })
      const pageData = asAdminPage<KitchenwareItem>(response.data, ['items'])
      setItems(pageData.items)
      setTotal(pageData.total)
      setMessage('')
    } catch (error) {
      console.error('Kitchenware loading failed:', error)
      setMessage('厨具数据加载失败')
    } finally {
      setLoading(false)
    }
  }, [category, page, search, status])

  const fetchCatalog = useCallback(async () => {
    try {
      setLoading(true)
      const response = await api.get('/admin/kitchenware/catalog', {
        params: {
          search: search.trim() || undefined,
          category,
          page,
          pageSize,
        },
      })
      const pageData = asAdminPage<KitchenwareCatalogItem>(response.data, ['items'])
      setCatalog(pageData.items)
      setTotal(pageData.total)
      setMessage('')
    } catch (error) {
      console.error('Kitchenware catalog loading failed:', error)
      setMessage('官方厨具目录加载失败')
    } finally {
      setLoading(false)
    }
  }, [category, page, search])

  const currentCatalogRefresh = useRef<typeof fetchCatalog | null>(null)
  useLayoutEffect(() => {
    currentCatalogRefresh.current = fetchCatalog
    return () => {
      currentCatalogRefresh.current = null
    }
  }, [fetchCatalog])
  useLayoutEffect(() => () => {
    pendingSave.current = null
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (activeTab === 'catalog') void fetchCatalog()
      else void fetchItems()
    }, 250)
    return () => window.clearTimeout(timer)
  }, [activeTab, fetchCatalog, fetchItems])

  const categories = useMemo(() => {
    const found = new Set(DEFAULT_CATEGORIES)
    for (const item of [...catalog, ...items]) {
      if (item.category) found.add(item.category)
    }
    return Array.from(found)
  }, [catalog, items])

  const stats = useMemo(() => ({
    attention: items.filter((item) => item.status === '需保养' || item.status === '维修中').length,
    owners: new Set(items.map((item) => item.user_id)).size,
    pageCount: activeTab === 'catalog' ? catalog.length : items.length,
  }), [activeTab, catalog.length, items])

  const updateStatus = async (item: KitchenwareItem, nextStatus: string) => {
    try {
      await api.put(`/admin/kitchenware/${item.id}/status`, { status: nextStatus })
      setItems((current) => current.map((entry) => (
        entry.id === item.id ? { ...entry, status: nextStatus } : entry
      )))
    } catch (error: any) {
      setMessage(error.response?.data?.error || '状态更新失败')
    }
  }

  const removeItem = async (item: KitchenwareItem) => {
    if (!window.confirm(`确定要将厨具【${item.name}】移入回收站吗？`)) return
    try {
      await api.delete(`/admin/kitchenware/${item.id}`)
      void fetchItems()
    } catch (error: any) {
      setMessage(error.response?.data?.error || '删除失败')
    }
  }

  const removeCatalogItem = async (item: KitchenwareCatalogItem) => {
    if (!window.confirm(`确定删除官方厨具【${item.name}】吗？`)) return
    try {
      await api.delete(`/admin/kitchenware/catalog/${item.id}`)
      void fetchCatalog()
    } catch (error: any) {
      setMessage(error.response?.data?.error || '删除失败')
    }
  }

  const openCatalogModal = (item?: KitchenwareCatalogItem) => {
    if (pendingSave.current) return
    setCatalogSaveError('')
    setEditingCatalogItem(item || null)
    setCatalogForm({
      name: item?.name || '',
      category: item?.category || '其他',
      aliases: parseListJson(item?.aliases).join('、'),
      cookingMethods: parseListJson(item?.cooking_methods).join('、'),
      careNote: item?.care_note || item?.description || '',
      imageUrl: item?.image_url || '',
    })
    setCatalogModalOpen(true)
  }

  const saveCatalogItem = async (event: FormEvent) => {
    event.preventDefault()
    if (pendingSave.current) return
    const token = Symbol('save')
    pendingSave.current = token
    setSavingCatalog(true)
    setCatalogSaveError('')
    const payload = {
      name: catalogForm.name.trim(),
      category: catalogForm.category,
      aliases: catalogForm.aliases.split(/[、,，]/).map((part) => part.trim()).filter(Boolean),
      cooking_methods: catalogForm.cookingMethods.split(/[、,，]/).map((part) => part.trim()).filter(Boolean),
      care_note: catalogForm.careNote.trim(),
      image_url: catalogForm.imageUrl.trim() || null,
      description: catalogForm.careNote.trim() || null,
    }
    try {
      if (editingCatalogItem) {
        await api.put(`/admin/kitchenware/catalog/${editingCatalogItem.id}`, payload)
      } else {
        await api.post('/admin/kitchenware/catalog', payload)
      }
      if (pendingSave.current === token) {
        setCatalogModalOpen(false)
        void currentCatalogRefresh.current?.()
      }
    } catch (error: any) {
      if (pendingSave.current === token) {
        setCatalogSaveError(error.response?.data?.error || '保存官方厨具失败')
      }
    } finally {
      if (pendingSave.current === token) pendingSave.current = null
      setSavingCatalog(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-foreground text-xl font-semibold tracking-tight">厨具管理</h1>
          <p className="text-muted-foreground text-sm">
            维护官方厨具目录与用户资产；目录用于推荐匹配，资产用于厨房能力画像。
          </p>
        </div>
        {activeTab === 'catalog' ? (
          <Button onClick={() => openCatalogModal()}>
            <Plus />
            新增官方厨具
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: activeTab === 'catalog' ? '官方厨具' : '用户厨具', value: total, icon: CookingPot },
          { label: '当前页条目', value: stats.pageCount, icon: Wrench },
          { label: '需关注资产', value: stats.attention, icon: Wrench },
          { label: '关联录入用户', value: stats.owners, icon: UserRound },
        ].map((stat) => (
          <Card key={stat.label} className="py-3">
            <CardContent className="flex items-center gap-3">
              <div className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-xl">
                <stat.icon className="size-5" />
              </div>
              <div>
                <p className="text-muted-foreground text-xs">{stat.label}</p>
                <p className="text-foreground text-xl font-semibold tracking-tight">
                  {loading ? '—' : stat.value.toLocaleString()}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          setActiveTab(value as 'catalog' | 'assets')
          setPage(1)
        }}
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <TabsList>
            <TabsTrigger value="catalog">官方目录</TabsTrigger>
            <TabsTrigger value="assets">用户资产</TabsTrigger>
          </TabsList>
          <div className="flex flex-1 flex-col gap-2 sm:flex-row lg:max-w-3xl lg:justify-end">
            <div className="relative min-w-0 flex-1">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                className="pl-9"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setPage(1)
                }}
                placeholder={activeTab === 'catalog' ? '搜索官方厨具、别名或描述' : '搜索厨具、备注或用户名'}
              />
            </div>
            <Select
              value={category}
              onValueChange={(value) => {
                setCategory(value)
                setPage(1)
              }}
            >
              <SelectTrigger className="sm:w-44">
                <SelectValue placeholder="分类" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((item) => (
                  <SelectItem key={item} value={item}>{item}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {activeTab === 'assets' ? (
              <Select
                value={status}
                onValueChange={(value) => {
                  setStatus(value)
                  setPage(1)
                }}
              >
                <SelectTrigger className="sm:w-36">
                  <SelectValue placeholder="状态" />
                </SelectTrigger>
                <SelectContent>
                  {statuses.map((item) => (
                    <SelectItem key={item} value={item}>{item}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
        </div>

        {message ? (
          <div role="alert" className="border-destructive/20 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm">
            {message}
          </div>
        ) : null}

        <TabsContent value="catalog">
          <Card className="gap-0 py-0">
            <CardHeader className="border-b py-4">
              <CardTitle>官方厨具目录</CardTitle>
              <CardDescription>用于菜谱匹配与用户资产映射的标准厨具库。</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>官方厨具</TableHead>
                    <TableHead>分类</TableHead>
                    <TableHead>别名</TableHead>
                    <TableHead>来源</TableHead>
                    <TableHead>说明</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {catalog.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Thumb src={item.image_url} alt="" />
                          <span className="font-medium">{item.name}</span>
                        </div>
                      </TableCell>
                      <TableCell><Badge variant="secondary">{item.category}</Badge></TableCell>
                      <TableCell className="text-muted-foreground max-w-[180px] truncate">
                        {parseListJson(item.aliases).join('、') || '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{item.source || '—'}</TableCell>
                      <TableCell className="text-muted-foreground max-w-[220px] truncate">
                        {item.description || item.care_note || '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center gap-1">
                          <Button type="button" variant="outline" size="sm" onClick={() => setCapabilityItem(item)}>
                            能力条件
                          </Button>
                          <Button type="button" variant="ghost" size="icon-sm" onClick={() => openCatalogModal(item)} title="编辑">
                            <Pencil />
                          </Button>
                          <Button type="button" variant="ghost" size="icon-sm" className="text-destructive" onClick={() => removeCatalogItem(item)} title="删除">
                            <Trash2 />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!loading && !catalog.length ? (
                <div className="text-muted-foreground px-4 py-12 text-center text-sm">没有匹配的官方厨具</div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="assets">
          <Card className="gap-0 py-0">
            <CardHeader className="border-b py-4">
              <CardTitle>用户厨具资产</CardTitle>
              <CardDescription>查看用户家中厨具状态，支持保养状态调整与回收。</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>厨具</TableHead>
                    <TableHead>所属用户</TableHead>
                    <TableHead>分类</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>购买日期</TableHead>
                    <TableHead>最近保养</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Thumb src={item.image_url} alt="" />
                          <div className="min-w-0">
                            <p className="font-medium">{item.name}</p>
                            <p className="text-muted-foreground max-w-[220px] truncate text-xs">{item.note || '无备注'}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <UserRound className="text-muted-foreground size-4" />
                          {item.owner_username}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{item.category}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge variant={statusBadgeVariant(item.status)}>{item.status}</Badge>
                          <Select value={item.status} onValueChange={(value) => updateStatus(item, value)}>
                            <SelectTrigger className="h-7 w-[7.5rem]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {statuses.slice(1).map((entry) => (
                                <SelectItem key={entry} value={entry}>{entry}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{item.purchase_date || '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(item.last_maintained_at)}</TableCell>
                      <TableCell className="text-right">
                        <Button type="button" variant="ghost" size="icon-sm" className="text-destructive" onClick={() => removeItem(item)} title="移入回收站">
                          <Trash2 />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!loading && !items.length ? (
                <div className="text-muted-foreground px-4 py-12 text-center text-sm">没有匹配的厨具记录</div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">
          共 {total.toLocaleString()} 条 · 第 {page}/{totalPages} 页
        </p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={loading || page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            上一页
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={loading || page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
            下一页
          </Button>
        </div>
      </div>

      {capabilityItem ? <KitchenwareCapabilities key={capabilityItem.id} item={capabilityItem} onClose={() => setCapabilityItem(null)} /> : null}

      {catalogModalOpen ? (
        <DialogFrame
          className="admin-dialog-backdrop"
          aria-label={editingCatalogItem ? '编辑官方厨具' : '新增官方厨具'}
          busy={savingCatalog}
          onClose={() => setCatalogModalOpen(false)}
        >
          <form onSubmit={saveCatalogItem} className="bg-card text-card-foreground grid w-full max-w-lg gap-4 rounded-xl p-5 shadow-xl ring-1 ring-foreground/10">
            <div className="flex items-start justify-between gap-3">
              <div className="pr-2">
                <h2 className="text-base font-semibold">{editingCatalogItem ? '编辑官方厨具' : '新增官方厨具'}</h2>
                <p className="text-muted-foreground mt-1 text-sm">名称与分类会进入推荐匹配；别名可提高用户搜索命中率。</p>
              </div>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭" disabled={savingCatalog} onClick={() => setCatalogModalOpen(false)}>
                ×
              </Button>
            </div>
            <fieldset disabled={savingCatalog} className="grid gap-3">
              <div>
                <Label htmlFor="kw-name">名称</Label>
                <Input id="kw-name" required value={catalogForm.name} onChange={(event) => setCatalogForm({ ...catalogForm, name: event.target.value })} />
              </div>
              <div>
                <Label htmlFor="kw-category">分类</Label>
                <select
                  id="kw-category"
                  className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                  value={catalogForm.category}
                  onChange={(event) => setCatalogForm({ ...catalogForm, category: event.target.value })}
                >
                  {categories.filter((item) => item !== '全部').map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="kw-image">图片 URL</Label>
                <Input id="kw-image" value={catalogForm.imageUrl} onChange={(event) => setCatalogForm({ ...catalogForm, imageUrl: event.target.value })} placeholder="https://..." />
              </div>
              <div>
                <Label htmlFor="kw-aliases">别名（顿号或逗号分隔）</Label>
                <Input id="kw-aliases" value={catalogForm.aliases} onChange={(event) => setCatalogForm({ ...catalogForm, aliases: event.target.value })} />
              </div>
              <div>
                <Label htmlFor="kw-methods">烹饪方式（顿号或逗号分隔）</Label>
                <Input id="kw-methods" value={catalogForm.cookingMethods} onChange={(event) => setCatalogForm({ ...catalogForm, cookingMethods: event.target.value })} />
              </div>
              <div>
                <Label htmlFor="kw-care">保养提示 / 说明</Label>
                <Textarea id="kw-care" rows={4} value={catalogForm.careNote} onChange={(event) => setCatalogForm({ ...catalogForm, careNote: event.target.value })} />
              </div>
            </fieldset>
            {catalogSaveError ? <p role="alert" className="text-destructive text-sm">{catalogSaveError}</p> : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" disabled={savingCatalog} onClick={() => setCatalogModalOpen(false)}>取消</Button>
              <Button type="submit" disabled={savingCatalog} className={cn(savingCatalog && 'opacity-70')}>
                保存
              </Button>
            </div>
          </form>
        </DialogFrame>
      ) : null}
    </div>
  )
}
