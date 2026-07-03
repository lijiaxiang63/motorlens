// Results screen dispatcher: picks the family layout for a completed test.
// All shared machinery (report build + __lastReport, StrictMode-safe
// auto-save, notes, deltas, thresholds) lives in results/useResultSession;
// header/warnings chrome in results/ResultHeader. The tremor view joins
// the switch with its milestone.

import type { ResultProps } from '../nav'
import { CycleResultsView } from './results/CycleResultsView'
import { RomResultsView } from './results/RomResultsView'

export function ResultsScreen({ result }: { result: ResultProps }) {
  switch (result.family) {
    case 'cycle':
      return <CycleResultsView result={result} />
    case 'rom':
      return <RomResultsView result={result} />
  }
}
