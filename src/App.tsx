import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Link, RouterProvider, useRouteError } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { AppLayout } from '@/layouts/AppLayout'
import { useSettings } from '@/hooks/useData'
import { useApplyTheme } from '@/hooks/useTheme'
import DashboardPage from '@/pages/DashboardPage'
import GeneratorPage from '@/pages/GeneratorPage'

const TemplatesPage = lazy(() => import('@/pages/TemplatesPage'))
const TemplateEditorPage = lazy(() => import('@/pages/TemplateEditorPage'))
const BulkPage = lazy(() => import('@/pages/BulkPage'))
const HistoryPage = lazy(() => import('@/pages/HistoryPage'))
const SettingsPage = lazy(() => import('@/pages/SettingsPage'))

function Lazy({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      {children}
    </Suspense>
  )
}

function RouteError() {
  const error = useRouteError() as { status?: number; message?: string } | undefined
  const notFound = error?.status === 404
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-semibold">{notFound ? 'Page not found' : 'Something went wrong'}</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        {notFound
          ? 'The page you are looking for does not exist.'
          : (error?.message ?? 'An unexpected error occurred. Your saved data is safe on this device.')}
      </p>
      <div className="flex gap-2">
        <Button asChild>
          <Link to="/">Go to dashboard</Link>
        </Button>
        {!notFound && (
          <Button variant="outline" onClick={() => window.location.reload()}>
            Reload
          </Button>
        )}
      </div>
    </div>
  )
}

const router = createBrowserRouter([
  {
    element: <AppLayout />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <DashboardPage />, errorElement: <RouteError /> },
      { path: '/generate', element: <GeneratorPage />, errorElement: <RouteError /> },
      { path: '/templates', element: <Lazy><TemplatesPage /></Lazy>, errorElement: <RouteError /> },
      { path: '/templates/:id/edit', element: <Lazy><TemplateEditorPage /></Lazy>, errorElement: <RouteError /> },
      { path: '/bulk', element: <Lazy><BulkPage /></Lazy>, errorElement: <RouteError /> },
      { path: '/history', element: <Lazy><HistoryPage /></Lazy>, errorElement: <RouteError /> },
      { path: '/settings', element: <Lazy><SettingsPage /></Lazy>, errorElement: <RouteError /> },
      { path: '*', element: <RouteError /> },
    ],
  },
])

export default function App() {
  const settings = useSettings()
  useApplyTheme(settings.theme)
  const dark =
    settings.theme === 'dark' ||
    (settings.theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  return (
    <TooltipProvider>
      <RouterProvider router={router} />
      <Toaster position="top-center" richColors closeButton theme={dark ? 'dark' : 'light'} />
    </TooltipProvider>
  )
}
