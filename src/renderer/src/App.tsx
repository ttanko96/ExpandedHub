import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { InstallDialog } from './components/install/InstallDialog'
import { ErrorBoundary } from './components/layout/ErrorBoundary'
import { Footer } from './components/layout/Footer'
import { PageBackdrop } from './components/layout/PageBackdrop'
import { Toaster } from './components/layout/Toaster'
import { TopNav } from './components/layout/TopNav'
import { ModDetailPage } from './pages/ModDetailPage'
import { ModsPage } from './pages/ModsPage'
import { useHub } from './store/hub-store'

// The landing page loads eagerly; everything else on first visit, for a faster start.
const DownloadsPage = lazy(() => import('./pages/DownloadsPage').then((m) => ({ default: m.DownloadsPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })))

export function App() {
  const init = useHub((s) => s.init)
  const location = useLocation()
  const theme = useHub((s) => s.settings?.general.theme)
  useEffect(() => init(), [init])
  useEffect(() => {
    if (!theme) return
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('theme', theme)
    } catch {
      /* only speeds up the next start */
    }
  }, [theme])
  useEffect(() => {
    const onError = (e: ErrorEvent) => void window.hub.app.log('error', `Uncaught: ${e.message}`, e.error?.stack)
    const onRejection = (e: PromiseRejectionEvent) => void window.hub.app.log('error', `Unhandled rejection: ${String(e.reason)}`, e.reason?.stack)
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  return (
    <div className="flex h-full flex-col">
      <TopNav />
      <PageBackdrop />
      <main className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="relative flex-1">
        <ErrorBoundary resetKey={location.pathname}>
        <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<Navigate to="/mods" replace />} />
          <Route path="/mods" element={<ModsPage />} />
          <Route path="/mods/:id" element={<ModDetailPage />} />
          <Route path="/downloads" element={<DownloadsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/mods" replace />} />
        </Routes>
        </Suspense>
        </ErrorBoundary>
        </div>
        <Footer />
      </main>
      <InstallDialog />
      <Toaster />
    </div>
  )
}
