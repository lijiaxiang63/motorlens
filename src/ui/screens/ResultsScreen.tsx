// Results screen dispatcher: picks the family layout for a completed test.
// All shared machinery (report build + __lastReport, StrictMode-safe
// auto-save, notes, deltas, thresholds) lives in results/useResultSession;
// header/warnings chrome in results/ResultHeader. Tremor and ROM views join
// the switch with their milestones.

import type { ResultProps } from '../nav'
import { CycleResultsView } from './results/CycleResultsView'

export function ResultsScreen({ result }: { result: ResultProps }) {
  switch (result.def.family) {
    case 'cycle':
      return <CycleResultsView result={result} />
  }
}
