// Subject / result / video persistence on top of the IndexedDB wrapper.
// The quick-test flow (no subject selected) never touches this module.

import { SAVE_VIDEO_DEFAULT } from '../config'
import type { Hand, ReportSubject, SessionReport, TestId } from '../types'
import {
  idbDelete,
  idbGet,
  idbGetAll,
  idbPut,
  STORE_RESULTS,
  STORE_SETTINGS,
  STORE_SUBJECTS,
  STORE_VIDEOS,
} from './db'

export interface Subject {
  id: string
  /** Operator-facing identifier, required and unique. */
  code: string
  name: string
  sex: 'male' | 'female' | 'other' | ''
  birthYear: number | null
  dominantHand: Hand | ''
  diagnosis: string
  notes: string
  createdAt: string
}

export interface StoredResult {
  id: string
  subjectId: string
  // Duplicated out of `report` so lists render without the large payload.
  testId: TestId
  hand: Hand
  source: 'live' | 'video'
  startedAt: string
  /** Key into the videos store. Live captures use `live_<resultId>`; all
   *  segments of one uploaded file share a single `upload_<uuid>` video. */
  videoKey?: string
  report: SessionReport
}

export interface StoredVideo {
  key: string
  blob: Blob
  mimeType: string
  /** Original upload name (uploads only) — used for the ZIP entry name. */
  fileName?: string
}

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`
}

// --- subjects ---

export async function listSubjects(): Promise<Subject[]> {
  const all = await idbGetAll<Subject>(STORE_SUBJECTS)
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function getSubject(id: string): Promise<Subject | undefined> {
  return idbGet<Subject>(STORE_SUBJECTS, id)
}

/** Insert or update; rejects with a friendly error on a duplicate code. */
export async function saveSubject(subject: Subject): Promise<void> {
  const clash = (await idbGetAll<Subject>(STORE_SUBJECTS)).find(
    (s) => s.code === subject.code && s.id !== subject.id,
  )
  if (clash) throw new Error(`A subject with code "${subject.code}" already exists`)
  await idbPut(STORE_SUBJECTS, subject)
}

/** Delete a subject with all of their results and videos. */
export async function deleteSubject(id: string): Promise<void> {
  const results = await listResults(id)
  for (const r of results) await deleteResult(r)
  await idbDelete(STORE_SUBJECTS, id)
}

// --- results ---

export async function listResults(subjectId: string): Promise<StoredResult[]> {
  const rows = await idbGetAll<StoredResult>(STORE_RESULTS, 'subjectId', subjectId)
  return rows.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

export function listAllResults(): Promise<StoredResult[]> {
  return idbGetAll<StoredResult>(STORE_RESULTS)
}

export function saveResult(result: StoredResult): Promise<void> {
  return idbPut(STORE_RESULTS, result)
}

/** Delete a result; garbage-collect its video when no other result uses it. */
export async function deleteResult(result: StoredResult): Promise<void> {
  await idbDelete(STORE_RESULTS, result.id)
  if (!result.videoKey) return
  const remaining = await idbGetAll<StoredResult>(STORE_RESULTS)
  if (!remaining.some((r) => r.videoKey === result.videoKey)) {
    await idbDelete(STORE_VIDEOS, result.videoKey)
  }
}

// --- videos ---

export function getVideo(key: string): Promise<StoredVideo | undefined> {
  return idbGet<StoredVideo>(STORE_VIDEOS, key)
}

export function saveVideo(video: StoredVideo): Promise<void> {
  return idbPut(STORE_VIDEOS, video)
}

// --- settings ---

export async function getSaveVideoSetting(): Promise<boolean> {
  const row = await idbGet<{ key: string; value: boolean }>(STORE_SETTINGS, 'saveVideo')
  return row?.value ?? SAVE_VIDEO_DEFAULT
}

export function setSaveVideoSetting(value: boolean): Promise<void> {
  return idbPut(STORE_SETTINGS, { key: 'saveVideo', value })
}

// --- report embedding ---

/** Only non-empty fields go into the exported report. */
export function subjectToReportSubject(s: Subject): ReportSubject {
  return {
    code: s.code,
    ...(s.name ? { name: s.name } : {}),
    ...(s.sex ? { sex: s.sex } : {}),
    ...(s.birthYear !== null ? { birthYear: s.birthYear } : {}),
    ...(s.dominantHand ? { dominantHand: s.dominantHand } : {}),
    ...(s.diagnosis ? { diagnosis: s.diagnosis } : {}),
    ...(s.notes ? { notes: s.notes } : {}),
  }
}
