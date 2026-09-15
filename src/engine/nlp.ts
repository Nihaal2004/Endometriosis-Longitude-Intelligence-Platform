/**
 * nlp.ts — Free-text symptom extraction ("clinical normalization").
 *
 * This is Module 1-3 of the original proposal: patient narrative in, structured
 * symptom observations out ("terrible cramps during my period" -> severe menstrual
 * pain, menstrual context). It is a deterministic rule engine — clause-level
 * co-occurrence matching against the lexicon in nlpLexicon.ts — not a trained model,
 * for the same reason the pattern engine avoids putting statistics inside a language
 * model: a claim about what a patient said must be auditable back to the exact words
 * that produced it, not to opaque model weights.
 *
 * The output is a *proposal*, never applied directly to a patient's record. The UI
 * shows every match for the patient to confirm, edit or dismiss before anything is
 * saved — the same "patient review and traceability" requirement the ethics section
 * of the proposal states, applied here rather than only promised.
 */

import { getSymptom } from './symptoms'
import {
  DEFAULT_INFERRED_SEVERITY,
  DURATION_PATTERN,
  MENSTRUAL_CONTEXT_CUES,
  NEGATION_CUES,
  RECENT_ONSET_CUES,
  SEVERITY_LEXICON,
  SYMPTOM_RULES,
  type SymptomRule,
} from './nlpLexicon'

export interface ExtractedSymptomMatch {
  symptomId: string
  /** false when the patient explicitly denied the symptom ("no nausea today"). */
  present: boolean
  /** 0-10. Only set for graded symptoms that are present. */
  severity?: number
  /** True when no severity word was found and a neutral default was used. */
  severityInferred: boolean
  /** The clause that produced this match, for the patient to see what triggered it. */
  sourceText: string
}

export interface NarrativeExtraction {
  matches: ExtractedSymptomMatch[]
  menstrualContext: boolean
  recentOnset: boolean
  durationText?: string
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function splitClauses(sentence: string): string[] {
  return sentence
    .split(/,|\bbut\b|\bhowever\b|\balthough\b|\byet\b/i)
    .map((c) => c.trim())
    .filter(Boolean)
}

function ruleMatches(rule: SymptomRule, clause: string): boolean {
  if (rule.unless?.some((rx) => rx.test(clause))) return false
  if (rule.strong?.some((rx) => rx.test(clause))) return true
  if (rule.requireAll?.every((group) => group.some((rx) => rx.test(clause)))) return true
  return false
}

function severityFor(clause: string): { score: number; inferred: boolean } {
  for (const { pattern, score } of SEVERITY_LEXICON) {
    if (pattern.test(clause)) return { score, inferred: false }
  }
  return { score: DEFAULT_INFERRED_SEVERITY, inferred: true }
}

/**
 * Extracts symptom observations from a patient's free-text narrative.
 *
 * Matching is clause-scoped: negation and severity are read from the same clause the
 * symptom cue was found in, not the whole text, so "terrible cramps, but no nausea"
 * correctly reports severe menstrual pain and denied nausea rather than mixing the two.
 *
 * Known limitation, stated rather than hidden: negation scope is the whole clause, not
 * a bounded word window, so a clause with two symptom cues on either side of a single
 * negation ("no pain or nausea") negates both, which is usually right, but a clause
 * structured the other way round could misattribute. Documented in docs/NLP.md.
 */
export function extractFromNarrative(text: string): NarrativeExtraction {
  const byId = new Map<string, ExtractedSymptomMatch>()

  for (const sentence of splitSentences(text)) {
    for (const clause of splitClauses(sentence)) {
      const negated = NEGATION_CUES.some((rx) => rx.test(clause))

      for (const rule of SYMPTOM_RULES) {
        if (!ruleMatches(rule, clause)) continue
        const def = getSymptom(rule.symptomId)
        const graded = def?.graded !== false

        const { score, inferred } = severityFor(clause)

        // Last mention of a symptom wins — the text is read chronologically, so a
        // later clause about the same symptom is the more current statement.
        byId.set(rule.symptomId, {
          symptomId: rule.symptomId,
          present: !negated,
          severity: graded && !negated ? score : undefined,
          severityInferred: inferred,
          sourceText: clause,
        })
      }
    }
  }

  const durationMatch = text.match(DURATION_PATTERN)

  return {
    matches: [...byId.values()],
    menstrualContext: MENSTRUAL_CONTEXT_CUES.some((rx) => rx.test(text)),
    recentOnset: RECENT_ONSET_CUES.some((rx) => rx.test(text)),
    durationText: durationMatch?.[0],
  }
}
