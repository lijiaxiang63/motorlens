// Routed wrapper: navigation chrome (Back, Save PDF) around the pure
// ReportView. Kept separate from ReportView (also used standalone, with no
// NavProvider, inside Electron's hidden print window — see src/main.tsx) so
// that context never needs useNav() to exist.

import { useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { isDesktop } from '../../platform'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/ui/button'
import { useNav } from '../nav'
import { ReportView } from '../report/ReportView'

export function ReportScreen({ kind, id }: { kind: 'session' | 'subject'; id: string }) {
  const { back } = useNav()

  // One-shot: if the underlying result/subject vanished (deleted elsewhere),
  // bounce back instead of rendering on missing data — mirrors CompareScreen's
  // ref-guarded pattern, guarded against StrictMode's double-invoked effects.
  const bouncedRef = useRef(false)
  const handleNotFound = useCallback(() => {
    if (bouncedRef.current) return
    bouncedRef.current = true
    toast.error('Report not found', {
      description:
        kind === 'session' ? 'That result no longer exists.' : 'That subject no longer exists.',
    })
    back()
  }, [kind, back])

  async function savePdf() {
    const defaultName = `motorlens_report_${kind}_${new Date().toISOString().slice(0, 10)}.pdf`
    if (isDesktop() && window.motorlens?.exportPdf) {
      const result = await window.motorlens.exportPdf({ kind, id, defaultName })
      if (result.saved) toast.success('Report saved', { description: result.path })
      else if (result.error) toast.error('Could not save report', { description: result.error })
      return
    }
    window.print()
  }

  return (
    <div className="mx-auto max-w-[1100px] px-6 pb-8 pt-6">
      <PageHeader
        title="Clinical report"
        description="Reference values below are user-configured cues, not validated clinical norms."
        actions={
          <>
            <Button variant="ghost" onClick={back}>
              ← Back
            </Button>
            <Button variant="primary" onClick={() => void savePdf()}>
              Save PDF
            </Button>
          </>
        }
      />
      <ReportView kind={kind} id={id} onNotFound={handleNotFound} />
    </div>
  )
}
