import { Outlet, NavLink, useLocation, useNavigate, Link } from 'react-router'
import {
  ChevronRight, X, LayoutDashboard,
  Apple, BookOpen, CookingPot, Users, MessageSquare, Bell, Award,
  BarChart3, Activity, SlidersHorizontal, Workflow, AudioLines,
  Settings, ShieldCheck, DatabaseZap, Bot, CloudUpload, PanelLeft, LogOut,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import api from '../services/api'
import { logoUrl } from '../assets'
import { adminGroups, adminLocation, adminParentPath, isAdminGroupOpen, workbench } from '../navigation/adminNavigation'
import { DialogFrame } from '../components/admin/DialogFrame'
import { AdminTopbar } from '../components/admin/AdminTopbar'
import { AdminUserMenu } from '../components/admin/AdminUserMenu'
import { Button } from '@/components/ui/button'
import { cn } from '@/utils/cn'
import './admin.css'

const pageIcons: Record<string, typeof Settings> = {
  '/admin/ingredients': Apple,
  '/admin/recipes': BookOpen,
  '/admin/kitchenware': CookingPot,
  '/admin/kitchenware-mapping-reviews': CookingPot,
  '/admin/users': Users,
  '/admin/feedback': MessageSquare,
  '/admin/community': MessageSquare,
  '/admin/notifications': Bell,
  '/admin/user-level-rule': Award,
  '/admin/analytics': BarChart3,
  '/admin/core-loops': Activity,
  '/admin/ai-providers': Bot,
  '/admin/ai-config': SlidersHorizontal,
  '/admin/ai-usage': BarChart3,
  '/admin/ai-conversations': MessageSquare,
  '/admin/agent-runs': Workflow,
  '/admin/voice-packs': AudioLines,
  '/admin/security': ShieldCheck,
  '/admin/media-cleanup': DatabaseZap,
  '/admin/app-updates': CloudUpload,
}

function savedGroups(): Record<string, boolean> {
  try {
    const value = JSON.parse(localStorage.getItem('admin.nav.groups') || '{}')
    return typeof value === 'object' && value !== null ? value : {}
  } catch {
    return {}
  }
}

/** lingpan-style menu button: soft card ring when active */
function menuButtonClass(active: boolean) {
  return cn(
    'flex h-8 w-full items-center gap-2 overflow-hidden rounded-lg px-2.5 text-[13px] font-medium transition-colors outline-none',
    active
      ? 'bg-card text-foreground shadow-[inset_0_0_0_1px_var(--border)]'
      : 'text-sidebar-foreground hover:bg-foreground/[0.04] hover:text-foreground',
  )
}

function menuSubClass(active: boolean) {
  return cn(
    'flex h-8 min-w-0 items-center gap-2 overflow-hidden rounded-lg px-2.5 text-[13px] font-normal transition-colors no-underline',
    active
      ? 'bg-card text-foreground font-medium shadow-[inset_0_0_0_1px_var(--border)]'
      : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground',
  )
}

export default function AdminLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const mainScrollRef = useRef<HTMLElement>(null)
  const [adminName, setAdminName] = useState('管理员')
  const [openGroups, setOpenGroups] = useState(() => {
    const group = adminLocation(location.pathname).group
    return { ...savedGroups(), ...(group ? { [group.id]: true } : {}) }
  })
  const [technicalOpen, setTechnicalOpen] = useState(() => !!adminLocation(location.pathname).group?.technical)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('admin.nav.collapsed') === '1' } catch { return false }
  })
  const current = adminLocation(location.pathname)
  const wasTechnical = useRef(!!current.group?.technical)
  const wasGroupId = useRef(current.group?.id)
  const dailyGroups = adminGroups.filter((group) => !group.technical)
  const technicalGroups = adminGroups.filter((group) => group.technical)

  useEffect(() => {
    document.title = (current.page?.label || '管理控制台') + '｜拾味日常'
  }, [current.page])

  useEffect(() => {
    let active = true
    api.get('/auth/me').then(({ data }) => {
      if (!active) return
      if (data.role !== 'admin') {
        localStorage.removeItem('adminToken')
        navigate('/login?reason=insufficient-role', { replace: true })
      } else {
        setAdminName(data.username || '管理员')
      }
    }).catch(() => undefined)
    return () => { active = false }
  }, [navigate])

  useEffect(() => { setMobileOpen(false) }, [location.pathname])
  useEffect(() => {
    const groupId = current.group?.id
    // Only auto-expand when entering a different group — allow manual collapse
    // while staying inside the same section (ingredients → recipes, etc.).
    if (groupId && groupId !== wasGroupId.current) {
      setOpenGroups((old) => ({ ...old, [groupId]: true }))
    }
    wasGroupId.current = groupId
    const technical = !!current.group?.technical
    // Respect a manual collapse while moving between technical pages. A fresh
    // entry from daily management should still reveal the active destination.
    if (technical && !wasTechnical.current) setTechnicalOpen(true)
    wasTechnical.current = technical
  }, [current.group, location.pathname])
  useLayoutEffect(() => { mainScrollRef.current?.scrollTo(0, 0) }, [location.pathname])

  const toggleGroup = (id: string) => setOpenGroups((old) => {
    const group = adminGroups.find((item) => item.id === id)!
    const next = { ...old, [id]: !isAdminGroupOpen(group, old) }
    try { localStorage.setItem('admin.nav.groups', JSON.stringify(next)) }
    catch { /* Navigation remains usable without storage. */ }
    return next
  })
  const toggleSidebarCollapsed = () => setSidebarCollapsed((prev) => {
    const next = !prev
    try { localStorage.setItem('admin.nav.collapsed', next ? '1' : '0') }
    catch { /* Navigation remains usable without storage. */ }
    return next
  })
  const logout = () => {
    localStorage.removeItem('adminToken')
    navigate('/login')
  }

  const renderGroup = (group: (typeof adminGroups)[number]) => {
    const open = isAdminGroupOpen(group, openGroups)
    return (
      <div key={group.id} className="px-0">
        <button
          type="button"
          className={cn(menuButtonClass(current.group?.id === group.id && !open), 'group/collapsible')}
          aria-expanded={open}
          onClick={() => toggleGroup(group.id)}
        >
          <group.icon aria-hidden="true" className="size-4 shrink-0 opacity-90" strokeWidth={1.85} />
          <span className="min-w-0 flex-1 truncate text-left">{group.label}</span>
          <ChevronRight
            size={14}
            aria-hidden="true"
            className={cn(
              'text-muted-foreground/50 ms-auto size-3.5 shrink-0 transition-transform duration-200',
              open && 'rotate-90',
            )}
          />
        </button>
        {open ? (
          <div className="border-border/70 mx-3.5 my-1 space-y-0.5 border-l px-2 py-0.5">
            {group.pages.map((page) => {
              const Icon = pageIcons[page.path] || group.icon
              const active = adminParentPath(location.pathname) === page.path
              return (
                <Link
                  key={page.path}
                  to={page.path}
                  aria-current={active ? 'page' : undefined}
                  className={menuSubClass(active)}
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0 opacity-90" strokeWidth={1.85} />
                  <span className="min-w-0 flex-1 truncate">{page.label}</span>
                </Link>
              )
            })}
          </div>
        ) : null}
      </div>
    )
  }

  const sidebar = (
    <>
      <div className="border-sidebar-border/80 relative z-20 flex h-12 shrink-0 items-center gap-1 border-b px-2">
        {sidebarCollapsed ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground mx-auto shrink-0"
            aria-label="展开侧栏"
            aria-pressed={true}
            onClick={toggleSidebarCollapsed}
          >
            <PanelLeft className="size-4 rotate-180" />
          </Button>
        ) : (
          <>
            <Link
              to="/admin"
              className="text-foreground hover:bg-foreground/[0.03] flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 no-underline transition-colors"
              title="工作台"
            >
              <img
                src={logoUrl}
                alt=""
                className="bg-card border-border size-8 shrink-0 rounded-lg border object-contain p-0.5"
              />
              <span className="min-w-0 truncate text-sm font-semibold tracking-tight">
                拾味日常
                <small className="text-muted-foreground mt-0 block text-[10px] font-normal tracking-[0.04em]">
                  管理控制台
                </small>
              </span>
            </Link>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground shrink-0"
              aria-label="折叠侧栏"
              aria-pressed={false}
              onClick={toggleSidebarCollapsed}
            >
              <PanelLeft className="size-4" />
            </Button>
          </>
        )}
      </div>

      <nav aria-label="管理导航" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 py-2 [scrollbar-width:thin]">
        <div className="px-0">
          <NavLink
            to={workbench.path}
            end
            title={workbench.label}
            className={({ isActive }) => menuButtonClass(isActive)}
          >
            <LayoutDashboard aria-hidden="true" className="size-4 shrink-0 opacity-90" strokeWidth={1.85} />
            {!sidebarCollapsed ? <span className="min-w-0 flex-1 truncate">{workbench.label}</span> : null}
          </NavLink>
        </div>

        {!sidebarCollapsed ? (
          <div className="px-2 pt-3 pb-1.5">
            <p className="text-muted-foreground text-[11px] font-medium tracking-[0.03em] uppercase">
              日常管理
            </p>
          </div>
        ) : <div className="pt-2" />}
        <div className="space-y-0.5">
          {sidebarCollapsed
            ? dailyGroups.flatMap((group) => group.pages.map((page) => {
              const Icon = pageIcons[page.path] || group.icon
              const active = adminParentPath(location.pathname) === page.path
              return (
                <Link key={page.path} to={page.path} title={page.label} aria-current={active ? 'page' : undefined} className={menuButtonClass(active)}>
                  <Icon aria-hidden="true" className="size-4 shrink-0 opacity-90" strokeWidth={1.85} />
                </Link>
              )
            }))
            : dailyGroups.map(renderGroup)}
        </div>

        <div className="border-sidebar-border mx-2 mt-3 mb-1 border-t" />
        {!sidebarCollapsed ? (
          <>
            <div className="px-2 pt-2 pb-1.5">
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1 text-left text-[11px] font-medium tracking-[0.03em] uppercase transition-colors"
                aria-expanded={technicalOpen}
                onClick={() => setTechnicalOpen((open) => !open)}
              >
                <span className="flex-1">技术管理</span>
                <ChevronRight
                  size={12}
                  aria-hidden="true"
                  className={cn('opacity-50 transition-transform duration-200', technicalOpen && 'rotate-90')}
                />
              </button>
            </div>
            {technicalOpen ? (
              <div className="space-y-0.5 pb-2">
                {technicalGroups.map(renderGroup)}
              </div>
            ) : null}
          </>
        ) : (
          <div className="space-y-0.5 pb-2">
            {technicalGroups.flatMap((group) => group.pages.map((page) => {
              const Icon = pageIcons[page.path] || group.icon
              const active = adminParentPath(location.pathname) === page.path
              return (
                <Link key={page.path} to={page.path} title={page.label} aria-current={active ? 'page' : undefined} className={menuButtonClass(active)}>
                  <Icon aria-hidden="true" className="size-4 shrink-0 opacity-90" strokeWidth={1.85} />
                </Link>
              )
            }))}
          </div>
        )}
      </nav>

      <footer className="border-sidebar-border border-t px-2 py-2.5">
        {!sidebarCollapsed ? <AdminUserMenu name={adminName} onLogout={logout} /> : (
          <Button type="button" variant="ghost" size="icon-sm" className="w-full" aria-label="退出登录" onClick={logout}>
            <LogOut className="size-4" />
          </Button>
        )}
      </footer>
    </>
  )

  return (
    <div className="admin-shell bg-background text-foreground">
      <a href="#admin-main" className="admin-skip">跳到正文</a>
      <aside
        className={cn(
          'admin-sidebar border-sidebar-border bg-sidebar text-sidebar-foreground z-10 flex shrink-0 flex-col border-r transition-[width] duration-200',
          sidebarCollapsed ? 'w-14' : 'w-[16.5rem]',
        )}
      >
        {sidebar}
      </aside>

      {mobileOpen ? (
        <DialogFrame
          className="fixed inset-0 z-50 flex bg-black/40 backdrop-blur-[1px]"
          aria-label="管理导航菜单"
          onClose={() => setMobileOpen(false)}
        >
          <aside className="bg-sidebar text-sidebar-foreground relative flex h-full w-[min(288px,88vw)] flex-col shadow-xl">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute top-2 right-2 z-10"
              aria-label="关闭菜单"
              onClick={() => setMobileOpen(false)}
            >
              <X />
            </Button>
            {sidebar}
          </aside>
        </DialogFrame>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopbar
          onOpenMenu={() => setMobileOpen(true)}
          breadcrumb={{
            groupLabel: current.group?.label,
            pageLabel: current.page?.label,
            showPage: location.pathname !== '/admin',
          }}
        />
        <main id="admin-main" ref={mainScrollRef} tabIndex={-1} className="bg-background min-h-0 flex-1 overflow-auto overscroll-contain">
          <div className="mx-auto w-full max-w-[1400px] px-4 py-5 md:px-7 md:py-7">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
