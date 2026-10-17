/** The one sign-in page (frontend/src/pages/LoginPage.tsx) switches between these flows. */
export type Mode = 'sign-in' | 'sign-up' | 'forgot' | 'reset'

export type FieldErrors = { email?: string; password?: string; confirm?: string }
