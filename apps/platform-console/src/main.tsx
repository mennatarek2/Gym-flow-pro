import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'
import { setUnauthorizedHandler } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useUiStore } from '@/stores/ui-store'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

setUnauthorizedHandler(() => {
  useAuthStore.getState().logout()
  useUiStore.getState().setBanner('Session expired — please sign in again.')
  if (window.location.pathname !== '/login') {
    window.location.assign(`/login`)
  }
})

queryClient.getQueryCache().subscribe((event) => {
  if (event.type === 'updated' && event.query.state.status === 'error') {
    const err = event.query.state.error
    const msg = err instanceof Error ? err.message : 'Something went wrong — please try again'
    if (!msg.toLowerCase().includes('401') && !msg.toLowerCase().includes('unauthorized')) {
      // Non-blocking banner for 5xx/network — auth errors redirect separately.
      if (String(err).includes('Network') || (err as { status?: number })?.status && (err as { status: number }).status >= 500) {
        useUiStore.getState().setBanner('Something went wrong — please try again.')
      }
    }
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
