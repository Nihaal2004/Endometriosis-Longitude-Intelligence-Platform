import { describe, expect, it } from 'vitest'
import { reportLabel } from '../engine/symptoms'
import { validateInterpretation, type CatalogEntry } from './interpret'

const catalog: CatalogEntry[] = [
  { id: 'painful_bm', label: 'Pain opening bowels', clinicalTerm: 'Dyschezia' },
  { id: 'custom_stabbing_hip', label: 'stabbing hip' },
]

describe('suggested clinical wording', () => {
  it('accepts a match to a symptom the patient could have picked', () => {
    expect(validateInterpretation({ match: 'catalog', catalogId: 'painful_bm', domain: 'bowel', graded: true }, catalog))
      .toEqual({ match: 'catalog', catalogId: 'painful_bm', domain: 'bowel', graded: true })
  })

  it('rejects a catalog id the patient was not offered', () => {
    expect(validateInterpretation({ match: 'catalog', catalogId: 'dyspareunia', domain: 'sexual' }, catalog)).toBeNull()
  })

  it('accepts a plain clinical term', () => {
    expect(validateInterpretation({ match: 'new', clinicalTerm: ' Menorrhagia ', domain: 'systemic', graded: false }, catalog))
      .toEqual({ match: 'new', clinicalTerm: 'Menorrhagia', domain: 'systemic', graded: false })
  })

  it('never lets a number into the report through a term', () => {
    expect(validateInterpretation({ match: 'new', clinicalTerm: 'Pain lasting 3 days', domain: 'pain' }, catalog)).toBeNull()
  })

  it('rejects markup, empty and overlong terms', () => {
    for (const clinicalTerm of ['<b>Dysuria</b>', '', 'D', 'A'.repeat(81)]) {
      expect(validateInterpretation({ match: 'new', clinicalTerm, domain: 'pain' }, catalog)).toBeNull()
    }
  })

  it('treats unclear and malformed answers as no suggestion', () => {
    expect(validateInterpretation({ match: 'unclear' }, catalog)).toBeNull()
    expect(validateInterpretation(null, catalog)).toBeNull()
    expect(validateInterpretation('Dyschezia', catalog)).toBeNull()
  })

  it('falls back to a valid domain', () => {
    expect(validateInterpretation({ match: 'new', clinicalTerm: 'Dysuria', domain: 'kidney' }, catalog))
      .toMatchObject({ domain: 'pain', graded: true })
  })
})

describe('report label', () => {
  it('keeps the patient’s words beside the clinical term', () => {
    expect(reportLabel('stabbing when I poo', 'Dyschezia')).toBe('Dyschezia (“stabbing when I poo”)')
  })

  it('is just the patient’s words when no term was kept', () => {
    expect(reportLabel('heavy legs', null)).toBe('heavy legs')
  })
})
