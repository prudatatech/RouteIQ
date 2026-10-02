import { createJSONStorage } from 'zustand/middleware'
import { useAuthStore } from '@/store/authStore'

/**
 * Tests only: newer Node versions ship a localStorage that hides jsdom's, and the auth store (persisted) was
 * created with it. Gives the store a plain in-memory storage so setState and clearAuth work in every environment.
 */
export function memoryAuthStorage(): void {
  const memory = new Map<string, string>()
  useAuthStore.persist.setOptions({
    storage: createJSONStorage(() => ({
      getItem: k => memory.get(k) ?? null,
      setItem: (k, v) => { memory.set(k, v) },
      removeItem: k => { memory.delete(k) },
    })),
  })
}
