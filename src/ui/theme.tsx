// Theme switching: `.dark` class on <html>, driven by a persisted preference
// (light | dark | system). localStorage mirrors the IndexedDB settings row so
// index.html can apply the class before first paint (no flash); IndexedDB is
// the durable copy. Charts re-read their colors when `resolved` changes.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { idbGet, idbPut, STORE_SETTINGS } from '../store/db'

export type ThemePref = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const LS_KEY = 'motorlens.theme'
/** Follow the OS by default; Electron's nativeTheme feeds prefers-color-scheme
 *  with zero IPC. Manual override persists to IDB (+ localStorage mirror). */
const DEFAULT_PREF: ThemePref = 'system'

function systemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function resolve(pref: ThemePref): ResolvedTheme {
  return pref === 'system' ? systemTheme() : pref
}

function apply(pref: ThemePref): ResolvedTheme {
  const resolved = resolve(pref)
  document.documentElement.classList.toggle('dark', resolved === 'dark')
  document.documentElement.style.colorScheme = resolved
  return resolved
}

function readLocalPref(): ThemePref {
  const v = localStorage.getItem(LS_KEY)
  return v === 'light' || v === 'dark' || v === 'system' ? v : DEFAULT_PREF
}

interface ThemeState {
  pref: ThemePref
  resolved: ResolvedTheme
  setPref(p: ThemePref): void
}

const ThemeContext = createContext<ThemeState | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(readLocalPref)
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(readLocalPref()))

  // Reconcile with the durable IndexedDB copy (e.g. localStorage was cleared).
  useEffect(() => {
    let cancelled = false
    void idbGet<{ key: string; value: ThemePref }>(STORE_SETTINGS, 'theme')
      .then((row) => {
        const v = row?.value
        if (!cancelled && (v === 'light' || v === 'dark' || v === 'system') && v !== readLocalPref()) {
          localStorage.setItem(LS_KEY, v)
          setPrefState(v)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Apply on change + follow OS changes while in system mode.
  useEffect(() => {
    setResolved(apply(pref))
    if (pref !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setResolved(apply('system'))
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [pref])

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p)
    localStorage.setItem(LS_KEY, p)
    void idbPut(STORE_SETTINGS, { key: 'theme', value: p }).catch(() => {})
  }, [])

  const value = useMemo(() => ({ pref, resolved, setPref }), [pref, resolved, setPref])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeState {
  const v = useContext(ThemeContext)
  if (!v) throw new Error('useTheme outside ThemeProvider')
  return v
}
