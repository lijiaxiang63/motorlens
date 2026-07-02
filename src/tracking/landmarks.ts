import { SWAP_RAW_HANDEDNESS } from '../config'
import type { Hand } from '../types'

/** Map MediaPipe's handedness label to the user's physical hand.
 *  tasks-vision assumes a mirrored (selfie) input; getUserMedia frames are
 *  unmirrored, so by default the label is swapped (see config). */
export function normalizeHandedness(raw: string | undefined): Hand | null {
  if (raw !== 'Left' && raw !== 'Right') return null
  const label = raw === 'Left' ? 'left' : 'right'
  if (!SWAP_RAW_HANDEDNESS) return label
  return label === 'left' ? 'right' : 'left'
}
