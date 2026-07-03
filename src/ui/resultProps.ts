// The one place a TestDefinition's compute() meets the results route: the
// switch narrows def per family so ResultProps always carries a correlated
// def/analysis pair. Record, stored-result view, and JSON import all route
// through here instead of hand-pairing `{ def, analysis: def.compute(...) }`.

import type { TestDefinition } from '../protocol/definitions'
import type { LandmarkFrame } from '../types'
import type { ResultCommon, ResultProps } from './nav'

export function buildResultProps(
  def: TestDefinition,
  frames: LandmarkFrame[],
  common: Omit<ResultCommon, 'frames'>,
): ResultProps {
  switch (def.family) {
    case 'cycle':
      return { ...common, frames, def, analysis: def.compute(frames) }
  }
}
