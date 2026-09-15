/**
 * nlp.test.ts — Gate for free-text symptom extraction.
 *
 * The first case reproduces the worked example from the project proposal verbatim
 * ("My periods have been extremely painful lately...") so the extractor's behaviour on
 * the exact sentence the panel was shown is pinned by a test, not just eyeballed.
 */

import { describe, expect, it } from 'vitest'
import { extractFromNarrative } from './nlp'

function find(matches: ReturnType<typeof extractFromNarrative>['matches'], symptomId: string) {
  return matches.find((m) => m.symptomId === symptomId)
}

describe('extractFromNarrative — proposal worked example', () => {
  const text =
    'My periods have been extremely painful lately. I also feel exhausted and sometimes get stomach pain when I use the bathroom.'
  const result = extractFromNarrative(text)

  it('detects severe menstrual pain', () => {
    const m = find(result.matches, 'menstrual_pain')
    expect(m?.present).toBe(true)
    expect(m?.severity).toBeGreaterThanOrEqual(8)
    expect(m?.severityInferred).toBe(false)
  })

  it('detects fatigue', () => {
    expect(find(result.matches, 'fatigue')?.present).toBe(true)
  })

  it('routes "stomach pain when I use the bathroom" to the bowel symptom, not generic bloating', () => {
    expect(find(result.matches, 'painful_bm')?.present).toBe(true)
    expect(find(result.matches, 'bloating')).toBeUndefined()
  })

  it('flags menstrual context and recent onset', () => {
    expect(result.menstrualContext).toBe(true)
    expect(result.recentOnset).toBe(true)
  })
})

describe('extractFromNarrative — negation', () => {
  it('does not report a symptom the patient explicitly denies', () => {
    const result = extractFromNarrative('I have no pelvic pain today, thankfully.')
    const m = find(result.matches, 'pelvic_pain')
    expect(m?.present).toBe(false)
    expect(m?.severity).toBeUndefined()
  })

  it('keeps negation scoped to its own clause', () => {
    const result = extractFromNarrative('Terrible cramps today, but no nausea at all.')
    expect(find(result.matches, 'menstrual_pain')?.present).toBe(true)
    expect(find(result.matches, 'nausea')?.present).toBe(false)
  })

  it('handles common contractions', () => {
    const result = extractFromNarrative("I haven't had any headaches this week.")
    expect(find(result.matches, 'headache')?.present).toBe(false)
  })
})

describe('extractFromNarrative — severity lexicon', () => {
  it('scores an unbearable/excruciating description at the top of the scale', () => {
    const result = extractFromNarrative('The pelvic pain was unbearable this morning.')
    expect(find(result.matches, 'pelvic_pain')?.severity).toBeGreaterThanOrEqual(9)
  })

  it('scores a mild description low', () => {
    const result = extractFromNarrative('Just a mild headache today.')
    const m = find(result.matches, 'headache')
    expect(m?.severity).toBeLessThanOrEqual(3)
    expect(m?.severityInferred).toBe(false)
  })

  it('falls back to a neutral inferred severity when no modifier is present', () => {
    const result = extractFromNarrative('I had some bloating.')
    const m = find(result.matches, 'bloating')
    expect(m?.severityInferred).toBe(true)
    expect(m?.severity).toBe(5)
  })
})

describe('extractFromNarrative — multi-domain co-occurrence', () => {
  it('detects two symptoms named in the same sentence', () => {
    const result = extractFromNarrative('Bad bloating and diarrhoea after eating lunch.')
    expect(find(result.matches, 'bloating')?.present).toBe(true)
    expect(find(result.matches, 'diarrhoea')?.present).toBe(true)
  })
})

describe('extractFromNarrative — non-matches', () => {
  it('returns no matches for text with no symptom content', () => {
    const result = extractFromNarrative('Had a good day, went for a walk and saw a friend.')
    expect(result.matches).toEqual([])
  })

  it('returns no matches for an empty string', () => {
    expect(extractFromNarrative('').matches).toEqual([])
  })
})

describe('extractFromNarrative — duration cue', () => {
  it('captures an explicit duration mention for display', () => {
    const result = extractFromNarrative('I have had this pelvic pain for three days now.')
    expect(result.durationText).toMatch(/three days/i)
  })

  it('leaves durationText unset when no duration is mentioned', () => {
    const result = extractFromNarrative('Pelvic pain today.')
    expect(result.durationText).toBeUndefined()
  })
})

describe('extractFromNarrative — determinism', () => {
  it('is a pure function: identical input yields identical output', () => {
    const text = 'Severe period pain and exhausted, with stomach pain in the bathroom.'
    expect(extractFromNarrative(text)).toEqual(extractFromNarrative(text))
  })
})

describe('extractFromNarrative — sensitive domain', () => {
  it('only surfaces sexual-domain symptoms when the patient names them', () => {
    const result = extractFromNarrative('Sex has been really painful the last few times.')
    expect(find(result.matches, 'dyspareunia')?.present).toBe(true)
  })

  it('does not infer a sensitive symptom from unrelated text', () => {
    const result = extractFromNarrative('Just tired and some back pain today.')
    expect(find(result.matches, 'dyspareunia')).toBeUndefined()
  })
})
