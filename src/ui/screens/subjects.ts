// Subjects list: registration form, per-subject summary rows, batch export.

import { buildBatchExport, downloadBatchExport } from '../../report/batch'
import {
  getVideo,
  listAllResults,
  listSubjects,
  newId,
  saveSubject,
  type StoredResult,
  type Subject,
} from '../../store/subjects'
import type { Hand } from '../../types'
import type { AppContext, ScreenInstance } from '../app'
import { h, statusChip } from '../components'

export function emptySubject(): Subject {
  return {
    id: newId(),
    code: '',
    name: '',
    sex: '',
    birthYear: null,
    dominantHand: '',
    diagnosis: '',
    notes: '',
    createdAt: new Date().toISOString(),
  }
}

/** Shared by the subjects screen (create) and subject screen (edit). */
export function subjectForm(
  initial: Subject,
  onSave: (s: Subject) => Promise<void>,
  onCancel: () => void,
): HTMLElement {
  const draft: Subject = { ...initial }
  const errorEl = h('div', { class: 'field-error', style: 'display:none' })

  const codeInput = h('input', { type: 'text', value: draft.code, required: true })
  const nameInput = h('input', { type: 'text', value: draft.name })
  const sexSelect = h(
    'select',
    {},
    ...(['', 'male', 'female', 'other'] as const).map((v) =>
      h('option', { value: v, selected: draft.sex === v }, v === '' ? '—' : v),
    ),
  )
  const birthInput = h('input', {
    type: 'number',
    min: 1900,
    max: new Date().getFullYear(),
    value: draft.birthYear === null ? '' : draft.birthYear,
  })
  const handSelect = h(
    'select',
    {},
    ...(['', 'left', 'right'] as const).map((v) =>
      h('option', { value: v, selected: draft.dominantHand === v }, v === '' ? '—' : v),
    ),
  )
  const diagInput = h('input', { type: 'text', value: draft.diagnosis })
  const notesInput = h('textarea', { rows: 2 }, draft.notes)

  const field = (label: string, control: HTMLElement, required = false) =>
    h('label', { class: 'field' }, h('span', {}, label + (required ? ' *' : '')), control)

  async function save() {
    draft.code = codeInput.value.trim()
    draft.name = nameInput.value.trim()
    draft.sex = sexSelect.value as Subject['sex']
    const by = Number(birthInput.value)
    draft.birthYear = birthInput.value.trim() !== '' && Number.isFinite(by) ? by : null
    draft.dominantHand = handSelect.value as Hand | ''
    draft.diagnosis = diagInput.value.trim()
    draft.notes = notesInput.value
    if (!draft.code) {
      errorEl.style.display = ''
      errorEl.textContent = 'Subject code is required'
      return
    }
    try {
      await onSave(draft)
    } catch (err) {
      errorEl.style.display = ''
      errorEl.textContent = String(err instanceof Error ? err.message : err)
    }
  }

  return h(
    'div',
    { class: 'test-card subject-form' },
    h(
      'div',
      { class: 'form-grid' },
      field('Code', codeInput, true),
      field('Name', nameInput),
      field('Sex', sexSelect),
      field('Birth year', birthInput),
      field('Dominant hand', handSelect),
      field('Diagnosis / group', diagInput),
    ),
    field('Notes', notesInput),
    errorEl,
    h(
      'div',
      { class: 'form-actions' },
      h('button', { class: 'btn ghost', onclick: onCancel }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: () => void save() }, 'Save subject'),
    ),
  )
}

export function createSubjectsScreen(ctx: AppContext): ScreenInstance {
  let destroyed = false
  let subjects: Subject[] = []
  let results: StoredResult[] = []

  const listEl = h('div', { class: 'card-list' }, h('p', { class: 'muted' }, 'Loading…'))
  const errorBox = h('div', { class: 'error-box', style: 'display:none' })
  const storageChipSlot = h('span', {})
  const newBtn = h('button', { class: 'btn primary', onclick: () => renderForm() }, 'New subject')
  const formSlot = h('div', {})

  function showError(err: unknown) {
    errorBox.style.display = ''
    errorBox.replaceChildren(
      h('strong', {}, 'Storage error: '),
      String(err instanceof Error ? err.message : err),
    )
  }

  async function load() {
    try {
      ;[subjects, results] = await Promise.all([listSubjects(), listAllResults()])
      if (destroyed) return
      renderList()
      exportBtn.disabled = results.length === 0
    } catch (err) {
      if (!destroyed) showError(err)
    }
    try {
      const est = await navigator.storage?.estimate?.()
      if (!destroyed && est?.usage !== undefined) {
        const mb = est.usage / (1024 * 1024)
        storageChipSlot.replaceChildren(
          statusChip(`${mb < 100 ? mb.toFixed(1) : mb.toFixed(0)} MB stored`, 'idle'),
        )
      }
    } catch {
      // storage estimate is best-effort
    }
  }

  function renderForm() {
    formSlot.replaceChildren(
      subjectForm(
        emptySubject(),
        async (s) => {
          await saveSubject(s)
          // Straight into the detail screen — fastest path for batch intake.
          ctx.navigate({ name: 'subject', subjectId: s.id })
        },
        () => formSlot.replaceChildren(),
      ),
    )
    formSlot.querySelector('input')?.focus()
  }

  function renderList() {
    if (subjects.length === 0) {
      listEl.replaceChildren(
        h('p', { class: 'muted' }, 'No subjects yet — register the first one to start a session.'),
      )
      return
    }
    const bySubject = new Map<string, StoredResult[]>()
    for (const r of results) {
      const arr = bySubject.get(r.subjectId) ?? []
      arr.push(r)
      bySubject.set(r.subjectId, arr)
    }
    listEl.replaceChildren(
      ...subjects.map((s) => {
        const rs = bySubject.get(s.id) ?? []
        const videos = new Set(rs.map((r) => r.videoKey).filter(Boolean)).size
        return h(
          'div',
          { class: 'subject-row' },
          h(
            'div',
            { class: 'subject-row-main' },
            h('strong', {}, s.code),
            s.name ? h('span', {}, s.name) : null,
            s.diagnosis ? h('span', { class: 'muted' }, s.diagnosis) : null,
          ),
          h(
            'span',
            { class: 'muted small' },
            `${rs.length} result${rs.length === 1 ? '' : 's'}${videos > 0 ? ` · ${videos} video${videos === 1 ? '' : 's'}` : ''}`,
          ),
          h(
            'button',
            {
              class: 'btn primary',
              onclick: () => ctx.navigate({ name: 'subject', subjectId: s.id }),
            },
            'Open',
          ),
        )
      }),
    )
  }

  void load()

  const exportBtn = h('button', { class: 'btn primary' }, 'Export all (ZIP)') as HTMLButtonElement
  exportBtn.addEventListener('click', () => void exportAll())

  async function exportAll() {
    if (results.length === 0) return
    exportBtn.disabled = true
    try {
      const entries = subjects
        .map((subject) => ({
          subject,
          results: results.filter((r) => r.subjectId === subject.id),
        }))
        .filter((e) => e.results.length > 0)
      const blob = await buildBatchExport(entries, getVideo, (done, total) => {
        exportBtn.textContent = `Preparing… ${done}/${total}`
      })
      if (destroyed) return
      // Exposed for automated verification (mirrors window.__lastReport).
      ;(window as unknown as Record<string, unknown>).__lastExport = blob
      downloadBatchExport(blob)
    } catch (err) {
      if (!destroyed) showError(err)
    } finally {
      exportBtn.disabled = false
      exportBtn.textContent = 'Export all (ZIP)'
    }
  }

  const headerActions = h('div', { class: 'header-actions' }, storageChipSlot, exportBtn)

  const el = h(
    'div',
    { class: 'screen subjects-screen' },
    h(
      'header',
      { class: 'app-header' },
      h(
        'div',
        {},
        h('h2', {}, 'Subjects'),
        h('p', { class: 'muted' }, 'Register subjects, run the test battery, export everything at the end.'),
      ),
      headerActions,
    ),
    h(
      'div',
      { class: 'subjects-toolbar' },
      h('button', { class: 'btn ghost', onclick: () => ctx.navigate({ name: 'home' }) }, '← Home'),
      newBtn,
    ),
    formSlot,
    errorBox,
    listEl,
  )

  return {
    el,
    destroy() {
      destroyed = true
    },
  }
}
