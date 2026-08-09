import { create } from 'zustand'

export type ToastTone = 'success' | 'error' | 'info'

export interface ToastMessage {
  message: string
  tone: ToastTone
  durationMs?: number
}

interface UiState {
  sidebarCollapsed: boolean
  banner: string | null
  toast: ToastMessage | null
  toggleSidebar: () => void
  setBanner: (message: string | null) => void
  showToast: (message: string, tone?: ToastTone, durationMs?: number) => void
  clearToast: () => void
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  banner: null,
  toast: null,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setBanner: (banner) => set({ banner }),
  showToast: (message, tone = 'info', durationMs = 4000) =>
    set({ toast: { message, tone, durationMs } }),
  clearToast: () => set({ toast: null }),
}))
