// Subject create/edit form — shared by the subjects list (create) and the
// subject detail screen (edit), like the vanilla subjectForm().

import { useState } from 'react'
import { newId, type Subject } from '../../store/subjects'
import type { Hand } from '../../types'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Field, Input, Select, Textarea } from './ui/field'

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

export function SubjectForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: Subject
  onSave(s: Subject): Promise<void>
  onCancel(): void
}) {
  const [code, setCode] = useState(initial.code)
  const [name, setName] = useState(initial.name)
  const [sex, setSex] = useState(initial.sex)
  const [birthYear, setBirthYear] = useState(initial.birthYear === null ? '' : String(initial.birthYear))
  const [dominantHand, setDominantHand] = useState(initial.dominantHand)
  const [diagnosis, setDiagnosis] = useState(initial.diagnosis)
  const [notes, setNotes] = useState(initial.notes)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const by = Number(birthYear)
    const draft: Subject = {
      ...initial,
      code: code.trim(),
      name: name.trim(),
      sex,
      birthYear: birthYear.trim() !== '' && Number.isFinite(by) ? by : null,
      dominantHand,
      diagnosis: diagnosis.trim(),
      notes,
    }
    if (!draft.code) {
      setError('Subject code is required')
      return
    }
    try {
      await onSave(draft)
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err))
    }
  }

  return (
    <Card className="mb-4">
      <div className="mb-2.5 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-3.5 gap-y-2.5">
        <Field label="Code" required>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
            data-testid="subject-code"
          />
        </Field>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Sex">
          <Select value={sex} onChange={(e) => setSex(e.target.value as Subject['sex'])}>
            {(['', 'male', 'female', 'other'] as const).map((v) => (
              <option key={v} value={v}>
                {v === '' ? '—' : v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Birth year">
          <Input
            type="number"
            min={1900}
            max={new Date().getFullYear()}
            value={birthYear}
            onChange={(e) => setBirthYear(e.target.value)}
          />
        </Field>
        <Field label="Dominant hand">
          <Select
            value={dominantHand}
            onChange={(e) => setDominantHand(e.target.value as Hand | '')}
          >
            {(['', 'left', 'right'] as const).map((v) => (
              <option key={v} value={v}>
                {v === '' ? '—' : v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Diagnosis / group">
          <Input value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} />
        </Field>
      </div>
      <Field label="Notes">
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      {error && <div className="mt-2 text-[13px] text-danger">{error}</div>}
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => void save()}>
          Save subject
        </Button>
      </div>
    </Card>
  )
}
