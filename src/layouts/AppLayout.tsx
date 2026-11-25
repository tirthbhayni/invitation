import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  FileStack,
  History,
  LayoutDashboard,
  Mail,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Send,
  Settings,
  Users,
  WifiOff,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { useOnline } from '@/hooks/useOnline'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/generate', label: 'Invitation Generator', icon: Send },
  { to: '/templates', label: 'Invitation Templates', icon: FileStack },
  { to: '/bulk', label: 'Bulk Invitations', icon: Users },
  { to: '/history', label: 'Invitation History', icon: History },
  { to: '/settings', label: 'Settings', icon: Settings },
]

function Brand({ collapsed }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-2 px-1">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-green-600 text-white">
        <Mail className="size-4" />
      </div>
      {!collapsed && (
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-semibold">InvitePrint</p>
          <p className="truncate text-[11px] text-muted-foreground">Personalized Invitations</p>
        </div>
      )}
    </div>
  )
}

function NavItems({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1" aria-label="Main navigation">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          title={collapsed ? label : undefined}
          className={({ isActive }) =>
            cn(
              'flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors md:min-h-10',
              collapsed && 'justify-center px-0',
              isActive
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
            )
          }
        >
          <Icon className="size-4 shrink-0" aria-hidden />
          {!collapsed && <span className="truncate">{label}</span>}
          {collapsed && <span className="sr-only">{label}</span>}
        </NavLink>
      ))}
    </nav>
  )
}

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === '1')
  const [mobileOpen, setMobileOpen] = useState(false)
  const online = useOnline()
  const location = useLocation()

  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', collapsed ? '1' : '0')
  }, [collapsed])

  useEffect(() => {
    document.getElementById('main-content')?.scrollTo?.(0, 0)
    window.scrollTo(0, 0)
  }, [location.pathname])

  return (
    <div className="flex min-h-dvh w-full">
      <a
        href="#main-content"
        className="sr-only z-50 rounded bg-background px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <aside
        className={cn(
          'sticky top-0 hidden h-dvh shrink-0 flex-col border-r bg-sidebar p-3 transition-[width] md:flex',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <div className={cn('mb-5 flex items-center', collapsed ? 'justify-center' : 'justify-between')}>
          <Brand collapsed={collapsed} />
        </div>
        <NavItems collapsed={collapsed} />
        <div className="mt-auto space-y-2">
          {!online && (
            <p className={cn('flex items-center gap-2 text-xs text-muted-foreground', collapsed && 'justify-center')}>
              <WifiOff className="size-3.5" /> {!collapsed && 'Offline mode'}
            </p>
          )}
          <Button
            variant="ghost"
            size="sm"
            className={cn('w-full text-muted-foreground', collapsed ? 'justify-center px-0' : 'justify-start')}
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            {!collapsed && 'Collapse'}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur md:hidden">
          <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu />
          </Button>
          <Brand />
          {!online && <WifiOff className="ml-auto size-4 text-muted-foreground" aria-label="Offline" />}
        </header>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-72 p-4">
            <SheetHeader className="p-0 pb-4">
              <SheetTitle asChild>
                <div>
                  <Brand />
                </div>
              </SheetTitle>
              <SheetDescription className="sr-only">Main navigation</SheetDescription>
            </SheetHeader>
            <NavItems onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>

        <main id="main-content" className="mx-auto w-full max-w-[1600px] min-w-0 flex-1 p-4 sm:p-5 lg:p-6" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
