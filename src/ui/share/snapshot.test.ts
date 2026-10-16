import { describe, expect, it } from 'vitest'
import { buildShareSnapshot, DEFAULT_PRIVACY, SHARE_SECTIONS, type ShareSectionId } from './snapshot'
import type { Claim, PatientRecord } from '../../engine/types'

const claim = (id: string, section: Claim['section'], text: string, verified = true): Claim => ({
  id,
  findingId: id,
  section,
  text,
  assertedValues: {},
  evidenceDates: [],
  verified,
})

const record: PatientRecord = {
  profile: { id: 'u', displayName: '', diagnosisStatus: 'suspected', enabledDomains: ['pain', 'sexual'] },
  days: [],
  treatments: [{ id: 't', kind: 'progestin', label: 'Dienogest', startDate: '2026-08-01' }],
  clinicalEvents: [{ id: 'e', kind: 'ultrasound', date: '2026-07-21', label: 'Ultrasound', outcome: 'Normal' }],
  trackedSymptomIds: ['pelvic_pain', 'dyspareunia'],
}

const claims: Claim[] = [
  claim('period', 'period', 'Recorded 1 Jul to 30 Sep.'),
  claim('cyclicity:pelvic_pain', 'findings', 'Pelvic pain clustered perimenstrually.'),
  claim('cyclicity:dyspareunia', 'findings', 'Dyspareunia was recorded on 6 days.'),
  claim('functional_burden', 'impact', 'Symptoms limited activity on 20 days.'),
  claim('medication_summary', 'medication', 'Analgesia on 12 days.'),
  claim('data_quality', 'quality', 'All information is patient-reported.'),
  claim('trend:fatigue', 'findings', 'An unverified claim.', false),
]

const window = { start: '2026-07-01', end: '2026-09-30', loggedDays: 80, calendarDays: 92, completeCycles: 3 }
const defaults = new Set(SHARE_SECTIONS.filter((s) => s.defaultOn).map((s) => s.id))
const texts = (r: ReturnType<typeof buildShareSnapshot>) => r.sections.flatMap((s) => s.claims.map((c) => c.text))

describe('share snapshot', () => {
  it('excludes sexual-health findings by default', () => {
    const r = buildShareSnapshot({ claims, record, window, concerns: ['Pelvic pain', 'Dyspareunia'], selected: defaults })
    expect(texts(r)).not.toContain('Dyspareunia was recorded on 6 days.')
    expect(r.concerns).toEqual(['Pelvic pain'])
  })

  it('includes them only when the patient opts in for this report', () => {
    const r = buildShareSnapshot({
      claims, record, window, concerns: ['Pelvic pain', 'Dyspareunia'],
      selected: new Set<ShareSectionId>([...defaults, 'sexual_health']),
    })
    expect(texts(r)).toContain('Dyspareunia was recorded on 6 days.')
    expect(r.concerns).toContain('Dyspareunia')
  })

  it('never shares a claim that failed verification', () => {
    const r = buildShareSnapshot({ claims, record, window, concerns: [], selected: defaults })
    expect(texts(r)).not.toContain('An unverified claim.')
  })

  it('drops a section the patient unticks, along with its data', () => {
    const selected = new Set(defaults)
    selected.delete('impact')
    selected.delete('timeline')
    const r = buildShareSnapshot({ claims, record, window, concerns: [], selected })
    expect(r.sections.map((s) => s.id)).not.toContain('impact')
    expect(r.timeline).toBeUndefined()
  })

  it('always keeps the recorded period and data-quality statement', () => {
    const r = buildShareSnapshot({ claims, record, window, concerns: [], selected: new Set() })
    expect(r.sections.map((s) => s.id)).toEqual(['period', 'quality'])
    expect(r.safetyStatement).toContain('not a diagnosis')
  })

  it('omits an empty name rather than inventing one', () => {
    const r = buildShareSnapshot({ claims, record, window, concerns: [], selected: defaults })
    expect(r.patient.displayName).toBeUndefined()
  })

  const named: PatientRecord = { ...record, profile: { ...record.profile, displayName: 'Veditha', priorLabels: ['IBS'] } }

  it('withholds the name by default, and includes it only when chosen', () => {
    const hidden = buildShareSnapshot({ claims, record: named, window, concerns: [], selected: defaults })
    expect(hidden.patient.displayName).toBeUndefined()
    expect(JSON.stringify(hidden)).not.toContain('Veditha')
    const shown = buildShareSnapshot({
      claims, record: named, window, concerns: [], selected: defaults, privacy: { ...DEFAULT_PRIVACY, name: true },
    })
    expect(shown.patient.displayName).toBe('Veditha')
  })

  it('can leave out the diagnosis status and earlier diagnoses', () => {
    const r = buildShareSnapshot({
      claims, record: named, window, concerns: [], selected: defaults, privacy: { ...DEFAULT_PRIVACY, diagnosis: false },
    })
    expect(r.patient.diagnosisStatus).toBeUndefined()
    expect(r.patient.priorLabels).toBeUndefined()
    expect(JSON.stringify(r)).not.toContain('IBS')
  })

  const withBackground: PatientRecord = {
    ...record,
    profile: {
      ...record.profile,
      ageAtMenarche: 12,
      background: { heavyBleeding: 'yes', typicalBleedingDays: 6, fertilityConcerns: 'yes', reproductiveGoals: 'trying' },
    },
  }

  it('includes menstrual history by default but never fertility unless chosen', () => {
    const r = buildShareSnapshot({ claims, record: withBackground, window, concerns: [], selected: defaults })
    const labels = r.background?.map((l) => l.label) ?? []
    expect(labels).toContain('Heavy periods')
    expect(labels).toContain('First period at age')
    expect(r.background?.some((l) => l.group === 'fertility')).toBe(false)
    const withFertility = buildShareSnapshot({
      claims, record: withBackground, window, concerns: [], selected: defaults, privacy: { ...DEFAULT_PRIVACY, fertility: true },
    })
    expect(withFertility.background?.find((l) => l.label === 'Plans for pregnancy')?.value).toBe('Trying to conceive')
  })

  it('can leave the whole background out', () => {
    const r = buildShareSnapshot({
      claims, record: withBackground, window, concerns: [], selected: defaults, privacy: { ...DEFAULT_PRIVACY, background: false },
    })
    expect(r.background).toBeUndefined()
  })

  it('shares an AI summary only of claims the link includes, and only when ticked', () => {
    const summary = {
      functional_burden: 'Symptoms limited 20 days.',
      'cyclicity:dyspareunia': 'Dyspareunia on 6 days.',
    }
    const r = buildShareSnapshot({ claims, record, window, concerns: [], selected: defaults, summary })
    expect(r.summary?.join(' ')).toContain('Symptoms limited 20 days.')
    expect(r.summary?.join(' ')).not.toContain('Dyspareunia')
    const off = new Set(defaults)
    off.delete('summary')
    expect(buildShareSnapshot({ claims, record, window, concerns: [], selected: off, summary }).summary).toBeUndefined()
  })
})

