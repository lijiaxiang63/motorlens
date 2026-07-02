// Subject detail: info header, test checklist (the batch-session workbench),
// saved results, and entry points for recording and video upload.

import { TEST_DEFS, testDefById } from '../../protocol/definitions'
import {
  deleteResult,
  deleteSubject,
  getSaveVideoSetting,
  getSubject,
  listResults,
  saveSubject,
  setSaveVideoSetting,
  type StoredResult,
  type Subject,
} from '../../store/subjects'
import type { CycleTestMetrics, Hand } from '../../types'
import type { AppContext, ScreenInstance } from '../app'
import { fmt, h } from '../components'
import { subjectForm } from './subjects'

const HANDS: readonly Hand[] = ['left', 'right']

function cycleMetrics(r: StoredResult): CycleTestMetrics | null {
  const m = r.report.metrics as CycleTestMetrics
  return typeof m.count === 'number' ? m : null
}

function metricsSnippet(r: StoredResult): string {
  const def = testDefById(r.testId)
  const m = cycleMetrics(r)
  if (!def || !m) return ''
  return `${m.count} ${def.eventNoun[1]} · ${fmt(m.frequencyHz, 2)} Hz`
}

export function createSubjectScreen(
  ctx: AppContext,
  subjectId: string,
  notice?: string,
): ScreenInstance {
  let destroyed = false
  let subject: Subject | null = null
  let results: StoredResult[] = []
  let saveVideo = true

  const body = h('div', {}, h('p', { class: 'muted' }, 'Loading…'))
  const errorBox = h('div', { class: 'error-box', style: 'display:none' })

  function showError(err: unknown) {
    errorBox.style.display = ''
    errorBox.replaceChildren(
      h('strong', {}, 'Storage error: '),
      String(err instanceof Error ? err.message : err),
    )
  }

  async function load() {
    try {
      const [s, rs, sv] = await Promise.all([
        getSubject(subjectId),
        listResults(subjectId),
        getSaveVideoSetting(),
      ])
      if (destroyed) return
      if (!s) {
        body.replaceChildren(h('p', { class: 'muted' }, 'Subject not found.'))
        return
      }
      subject = s
      results = rs
      saveVideo = sv
      render()
    } catch (err) {
      if (!destroyed) showError(err)
    }
  }

  function subjectCtx() {
    return { subject: subject!, saveVideo }
  }

  function metaLine(s: Subject): string {
    const parts: string[] = []
    if (s.sex) parts.push(s.sex)
    if (s.birthYear !== null) {
      parts.push(`b. ${s.birthYear} (${new Date().getFullYear() - s.birthYear} y)`)
    }
    if (s.dominantHand) parts.push(`${s.dominantHand}-handed`)
    if (s.diagnosis) parts.push(s.diagnosis)
    return parts.join(' · ')
  }

  function renderChecklist(): HTMLElement {
    const rows: HTMLElement[] = []
    let firstPendingMarked = false
    for (const def of TEST_DEFS) {
      for (const hand of HANDS) {
        const matches = results.filter((r) => r.testId === def.id && r.hand === hand)
        const latest = matches[0] // results sorted newest-first
        const pending = matches.length === 0
        const accent = pending && !firstPendingMarked
        if (accent) firstPendingMarked = true
        rows.push(
          h(
            'div',
            { class: `checklist-row${accent ? ' next' : ''}` },
            h(
              'span',
              { class: `check-glyph${pending ? ' pending' : ''}` },
              pending ? '—' : `✓${matches.length > 1 ? ` ×${matches.length}` : ''}`,
            ),
            h(
              'div',
              { class: 'checklist-main' },
              h('span', {}, `${def.title} — ${hand === 'left' ? 'Left' : 'Right'} hand`),
              latest ? h('span', { class: 'muted small' }, metricsSnippet(latest)) : null,
            ),
            h(
              'button',
              {
                class: `btn ${pending ? 'primary' : 'ghost'}`,
                onclick: () =>
                  ctx.navigate({ name: 'record', def, hand, subjectCtx: subjectCtx() }),
              },
              pending ? 'Start' : 'Redo',
            ),
          ),
        )
      }
    }

    const saveVideoToggle = h('label', { class: 'save-video-toggle' })
    const cb = h('input', { type: 'checkbox' })
    cb.checked = saveVideo
    cb.addEventListener('change', () => {
      saveVideo = cb.checked
      void setSaveVideoSetting(saveVideo).catch(() => {})
    })
    saveVideoToggle.append(cb, h('span', { class: 'small' }, 'Save camera video with each test (for later human review)'))

    return h(
      'div',
      { class: 'test-card' },
      h('h3', {}, 'Test battery'),
      saveVideoToggle,
      h('div', { class: 'checklist' }, ...rows),
    )
  }

  function renderVideoUpload(): HTMLElement {
    const input = h('input', {
      type: 'file',
      accept: 'video/*',
      style: 'display:none',
    }) as HTMLInputElement
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (file && subject) ctx.navigate({ name: 'videoReview', subject, file })
    })
    return h(
      'div',
      { class: 'test-card' },
      h('h3', {}, 'Analyze a video file'),
      h(
        'p',
        { class: 'muted' },
        'Upload a recording of finger tapping and/or fist open–close — one hand at a time ' +
          '(e.g. left hand first, then right). Segments are detected automatically and can be corrected before analysis.',
      ),
      h(
        'div',
        { class: 'card-footer' },
        h('span', { class: 'muted small' }, 'mp4 / webm / mov'),
        h('button', { class: 'btn ghost', onclick: () => input.click() }, 'Choose video…'),
      ),
      input,
    )
  }

  function renderResults(): HTMLElement {
    if (results.length === 0) {
      return h('div', {}, h('h3', { class: 'section-title' }, 'Results'), h('p', { class: 'muted' }, 'No results yet.'))
    }
    return h(
      'div',
      {},
      h('h3', { class: 'section-title' }, `Results (${results.length})`),
      h(
        'div',
        { class: 'card-list' },
        ...results.map((r) => {
          const def = testDefById(r.testId)
          return h(
            'div',
            { class: 'subject-row' },
            h(
              'div',
              { class: 'subject-row-main' },
              h('span', { class: `badge ${r.source}` }, r.source === 'live' ? 'LIVE' : 'VIDEO'),
              h('strong', {}, `${def?.title ?? r.testId} · ${r.hand === 'left' ? 'L' : 'R'}`),
              h('span', { class: 'muted small' }, new Date(r.startedAt).toLocaleString()),
              r.videoKey ? h('span', { class: 'muted small', title: 'video saved' }, '🎥') : null,
            ),
            h('span', { class: 'muted small' }, metricsSnippet(r)),
            h(
              'div',
              { class: 'row-actions' },
              h(
                'button',
                {
                  class: 'btn ghost',
                  onclick: () => {
                    if (!def || !subject) return
                    // Recompute from stored raw frames — same regression
                    // harness as the JSON import path.
                    const frames = r.report.raw.frames
                    ctx.navigate({
                      name: 'results',
                      result: {
                        def,
                        hand: r.hand,
                        analysis: def.compute(frames),
                        frames,
                        startedAt: r.startedAt,
                        durationMs: r.report.durationMs,
                        subject,
                        ...(r.report.source ? { source: r.report.source } : {}),
                        savedResultId: r.id,
                      },
                    })
                  },
                },
                'View',
              ),
              h(
                'button',
                {
                  class: 'btn ghost',
                  onclick: () => {
                    if (!confirm('Delete this result? Its saved video (if any) is removed too.')) return
                    void deleteResult(r)
                      .then(() => load())
                      .catch((err) => !destroyed && showError(err))
                  },
                },
                'Delete',
              ),
            ),
          )
        }),
      ),
    )
  }

  function render() {
    const s = subject!
    const editSlot = h('div', {})

    const noticeEl = notice
      ? h(
          'div',
          { class: 'notice-banner' },
          h('span', {}, notice),
          h(
            'button',
            {
              class: 'btn ghost',
              onclick: (e: Event) =>
                (e.currentTarget as HTMLElement).closest('.notice-banner')?.remove(),
            },
            'Dismiss',
          ),
        )
      : null
    notice = undefined // show once

    const children: HTMLElement[] = []
    children.push(
      h(
        'header',
        { class: 'app-header' },
        h(
          'div',
          {},
          h('h2', {}, s.name ? `${s.code} — ${s.name}` : s.code),
          h('p', { class: 'muted' }, metaLine(s) || 'No details recorded'),
        ),
        h(
          'div',
          { class: 'header-actions' },
          h('button', { class: 'btn ghost', onclick: () => ctx.navigate({ name: 'subjects' }) }, '← Subjects'),
          h(
            'button',
            {
              class: 'btn ghost',
              onclick: () => {
                editSlot.replaceChildren(
                  subjectForm(
                    s,
                    async (updated) => {
                      await saveSubject(updated)
                      subject = updated
                      render()
                    },
                    () => editSlot.replaceChildren(),
                  ),
                )
              },
            },
            'Edit',
          ),
          h(
            'button',
            {
              class: 'btn ghost danger',
              onclick: () => {
                if (!confirm(`Delete subject ${s.code} with all results and videos?`)) return
                void deleteSubject(s.id)
                  .then(() => ctx.navigate({ name: 'subjects' }))
                  .catch((err) => !destroyed && showError(err))
              },
            },
            'Delete subject',
          ),
        ),
      ),
    )
    if (noticeEl) children.push(noticeEl)
    children.push(editSlot, renderChecklist(), renderVideoUpload(), renderResults())
    body.replaceChildren(...children)
  }

  void load()

  const el = h('div', { class: 'screen subject-screen' }, errorBox, body)

  return {
    el,
    destroy() {
      destroyed = true
    },
  }
}
