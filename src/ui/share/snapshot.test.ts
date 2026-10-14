import { describe, expect, it } from 'vitest'
import { buildShareSnapshot, SHARE_SECTIONS, type ShareSectionId } from './snapshot'
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
})
