// Root component: theme + nav providers, app shell, screen switch.
// Screens are keyed by navCount so every navigation remounts (the previous
// router's destroy/recreate semantics — subscriptions and charts are cleaned
// up by effect teardown).

import { Toaster } from 'sonner'
import { CompareScreen } from './screens/CompareScreen'
import { HomeScreen } from './screens/HomeScreen'
import { RecordScreen } from './screens/RecordScreen'
import { ResultsScreen } from './screens/ResultsScreen'
import { MonitorScreen } from './screens/MonitorScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { SubjectScreen } from './screens/SubjectScreen'
import { SubjectsScreen } from './screens/SubjectsScreen'
import { TrendScreen } from './screens/TrendScreen'
import { VideoReviewScreen } from './screens/VideoReviewScreen'
import type { FrameSource } from '../types'
import { NavProvider, useNav, type ScreenRequest } from './nav'
import { Shell } from './shell/Shell'
import { ThemeProvider, useTheme } from './theme'

function ScreenView({ req }: { req: ScreenRequest }) {
  switch (req.name) {
    case 'home':
      return <HomeScreen />
    case 'record':
      return <RecordScreen def={req.def} hand={req.hand} subjectCtx={req.subjectCtx} />
    case 'results':
      return <ResultsScreen result={req.result} />
    case 'subjects':
      return <SubjectsScreen />
    case 'subject':
      return <SubjectScreen subjectId={req.subjectId} notice={req.notice} />
    case 'videoReview':
      return <VideoReviewScreen subject={req.subject} file={req.file} />
    case 'monitor':
      return <MonitorScreen />
    case 'settings':
      return <SettingsScreen />
    case 'trend':
      return (
        <TrendScreen
          subjectId={req.subjectId}
          testId={req.testId}
          metricKey={req.metricKey}
          hand={req.hand}
        />
      )
    case 'compare':
      return <CompareScreen subjectId={req.subjectId} aId={req.aId} bId={req.bId} />
  }
}

function AppInner() {
  const { screen, navCount } = useNav()
  return (
    <Shell>
      <div key={navCount} className="screen-enter h-full">
        <ScreenView req={screen} />
      </div>
    </Shell>
  )
}

export function App({ source }: { source: FrameSource }) {
  return (
    <ThemeProvider>
      <NavProvider initialSource={source}>
        <AppInner />
        <ThemedToaster />
      </NavProvider>
    </ThemeProvider>
  )
}

function ThemedToaster() {
  const { resolved } = useTheme()
  return <Toaster theme={resolved} position="bottom-right" richColors closeButton />
}
