// App shell: persistent left sidebar + top bar (window drag region) + a
// scrollable content pane. The content pane is the app's scroll container —
// navigation resets its scrollTop (the vanilla router used window.scrollTo).

import {
  Activity,
  FileUp,
  Hand,
  Moon,
  ScanLine,
  Settings,
  Sun,
  Users,
} from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { toast } from 'sonner'
import { isDesktop } from '../../platform'
import { cn } from '../lib/cn'
import { importSessionFile } from '../importSession'
import { useNav, type ScreenRequest } from '../nav'
import { useTheme } from '../theme'
import { Button } from '../components/ui/button'

const NAV_ITEMS: { name: ScreenRequest['name']; label: string; icon: typeof Users }[] = [
  { name: 'subjects', label: 'Subjects', icon: Users },
  { name: 'home', label: 'Quick Test', icon: ScanLine },
  { name: 'monitor', label: 'Joint Monitor', icon: Activity },
  { name: 'settings', label: 'Settings', icon: Settings },
]

/** Which sidebar entry a (possibly stacked) screen belongs to. */
function sectionOf(name: ScreenRequest['name']): ScreenRequest['name'] {
  switch (name) {
    case 'subject':
    case 'videoReview':
      return 'subjects'
    case 'record':
    case 'results':
      return 'home'
    default:
      return name
  }
}

const SCREEN_TITLES: Record<ScreenRequest['name'], string> = {
  home: 'Quick Test',
  subjects: 'Subjects',
  subject: 'Subject',
  record: 'Recording',
  results: 'Results',
  videoReview: 'Video Analysis',
  monitor: 'Joint Monitor',
  settings: 'Settings',
}

function Sidebar() {
  const { screen, ctx, navigate } = useNav()
  const active = sectionOf(screen.name)
  const fileRef = useRef<HTMLInputElement>(null)

  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r bg-surface">
      <div className="flex items-center gap-2.5 px-4 pb-4 pt-5">
        <div className="flex size-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <Hand className="size-[18px]" />
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight">MotorLens</div>
          <div className="text-[11px] text-muted-foreground">Motor assessment</div>
        </div>
      </div>

      <nav className="flex flex-col gap-0.5 px-2">
        {NAV_ITEMS.map(({ name, label, icon: Icon }) => (
          <button
            key={name}
            type="button"
            onClick={() => navigate({ name } as ScreenRequest)}
            className={cn(
              'flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] transition-colors',
              active === name
                ? 'bg-accent/12 font-medium text-accent'
                : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <FileUp className="size-4" />
          Import session…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            void importSessionFile(ctx, f).then((err) => {
              if (err) toast.error('Could not import session', { description: err })
            })
          }}
        />
      </nav>

      <div className="mt-auto px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
        Assessment aid, not a diagnostic device. All processing stays on this device.
      </div>
    </aside>
  )
}

function TopBar() {
  const { screen } = useNav()
  const { resolved, setPref } = useTheme()
  // hiddenInset traffic lights need clearance when running as a Mac app.
  const macDesktop = isDesktop() && navigator.platform.startsWith('Mac')

  return (
    <header
      className={cn(
        'flex h-12 shrink-0 items-center gap-3 border-b bg-surface px-4',
        macDesktop && 'pl-20',
      )}
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="text-[13px] font-medium text-muted-foreground">
        {SCREEN_TITLES[screen.name]}
      </div>
      <div className="ml-auto" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Toggle theme"
          onClick={() => setPref(resolved === 'dark' ? 'light' : 'dark')}
        >
          {resolved === 'dark' ? <Sun /> : <Moon />}
        </Button>
      </div>
    </header>
  )
}

export function Shell({ children }: { children: ReactNode }) {
  const { navCount } = useNav()
  const mainRef = useRef<HTMLElement>(null)

  useEffect(() => {
    mainRef.current?.scrollTo(0, 0)
  }, [navCount])

  return (
    <div className="flex h-full min-h-0 bg-background font-sans text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main ref={mainRef} className="min-h-0 flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
