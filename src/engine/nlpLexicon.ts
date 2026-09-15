/**
 * nlpLexicon.ts — The word lists and matching rules behind free-text symptom extraction.
 *
 * This is a Tier 1 rule engine (co-occurrence of regex cues within a clause), not a
 * trained model — deliberately, per the project's own feasibility plan: "rule-based
 * and statistical processing for core tasks... no model training infrastructure or
 * GPU cluster required." Every rule here is inspectable and testable by construction,
 * the same design principle the statistics engine applies to pattern detection.
 *
 * A SymptomRule fires for a clause when either:
 *   - any `strong` pattern matches on its own (an unambiguous phrase), or
 *   - every group in `requireAll` has at least one match (co-occurring cues), e.g.
 *     "bathroom" + "pain" in the same clause, without either word alone being enough.
 * `unless` suppresses the rule even if it would otherwise fire — used to route
 * ambiguous phrasing like "stomach pain" to the more specific symptom when bowel
 * context is also present, rather than double-reporting both.
 */

export interface SymptomRule {
  symptomId: string
  strong?: RegExp[]
  requireAll?: RegExp[][]
  unless?: RegExp[]
}

export const SYMPTOM_RULES: SymptomRule[] = [
  // --- Pain -------------------------------------------------------------
  {
    symptomId: 'menstrual_pain',
    // "cramps" alone defaults to menstrual cramps in this app's context — the one
    // deliberate domain assumption in the lexicon, stated rather than left implicit.
    strong: [/\bdysmenorrh\w*/i, /\bperiod pain\b/i, /\bmenstrual (pain|cramps?)\b/i, /\bperiod cramps?\b/i, /\bcramps?\b/i],
    requireAll: [[/\bperiods?\b/i, /\bmenstruat\w*/i], [/\bpain\w*\b/i, /\bhurts?\b/i, /\bsore\b/i, /\bache[sd]?\b/i]],
  },
  {
    symptomId: 'pelvic_pain',
    strong: [/\bpelvic pain\b/i],
    requireAll: [[/\bpelvis\b/i, /\bpelvic\b/i], [/\bpain\w*\b/i, /\bhurts?\b/i, /\bache[sd]?\b/i]],
  },
  {
    symptomId: 'lower_abdominal_pain',
    strong: [/\blower abdominal pain\b/i],
    requireAll: [[/\blower (abdomen|abdominal|belly|stomach|tummy)\b/i], [/\bpain\w*\b/i, /\bache[sd]?\b/i, /\bcramp\w*\b/i]],
  },
  {
    symptomId: 'ovulation_pain',
    strong: [/\bmittelschmerz\b/i, /\bovulation pain\b/i, /\bmid[- ]cycle pain\b/i],
  },
  {
    symptomId: 'lower_back_pain',
    strong: [/\blower back pain\b/i, /\bback pain\b/i],
    requireAll: [[/\bback\b/i], [/\bpain\w*\b/i, /\bache[sd]?\b/i, /\bhurts?\b/i, /\bsore\b/i]],
  },
  { symptomId: 'hip_pain', requireAll: [[/\bhip\b/i], [/\bpain\w*\b/i, /\bache[sd]?\b/i, /\bhurts?\b/i]] },
  { symptomId: 'leg_pain', requireAll: [[/\bleg\b/i, /\blegs\b/i], [/\bpain\w*\b/i, /\bache[sd]?\b/i, /\bhurts?\b/i]] },
  { symptomId: 'groin_pain', requireAll: [[/\bgroin\b/i], [/\bpain\w*\b/i, /\bache[sd]?\b/i, /\bhurts?\b/i]] },
  {
    symptomId: 'rectal_pain',
    requireAll: [[/\brectal\b/i, /\brectum\b/i, /\banus\b/i], [/\bpain\w*\b/i, /\bpressure\b/i, /\bache[sd]?\b/i]],
  },

  // --- Bowel --------------------------------------------------------------
  {
    symptomId: 'painful_bm',
    strong: [/\bdyschezia\b/i, /\bpainful bowel movements?\b/i, /\bpain(ful)? (pooping|opening (my )?bowels)\b/i],
    requireAll: [
      [/\bbathroom\b/i, /\btoilet\b/i, /\bbowel movements?\b/i, /\bpoop\w*\b/i, /\bstool\b/i, /\bdefecat\w*/i],
      [/\bpain\w*\b/i, /\bhurts?\b/i, /\bache[sd]?\b/i, /\bsore\b/i],
    ],
  },
  {
    symptomId: 'bloating',
    strong: [/\bbloat\w*\b/i, /\bstomach (ache|pain)\b/i, /\btummy (ache|pain)\b/i],
    requireAll: [[/\bstomach\b/i, /\babdomen\b/i, /\bbelly\b/i], [/\bache[sd]?\b/i, /\bpain\w*\b/i, /\bswell\w*\b/i]],
    unless: [/\bbathroom\b/i, /\btoilet\b/i, /\bbowel movements?\b/i, /\bpoop\w*\b/i, /\bstool\b/i],
  },
  {
    symptomId: 'abdominal_distension',
    strong: [/\babdominal (swelling|distension)\b/i, /\bswollen (belly|stomach|abdomen)\b/i],
  },
  { symptomId: 'constipation', strong: [/\bconstipat\w*\b/i, /\bcan'?t (go|poop)\b/i, /\bbackbacked? up\b/i] },
  { symptomId: 'diarrhoea', strong: [/\bdiarrh(o|oe|e)a\b/i, /\bloose (stools?|bowel movements?)\b/i] },
  {
    symptomId: 'nausea',
    strong: [/\bnause\w*\b/i, /\bqueasy\b/i, /\bsick to (my|the) stomach\b/i, /\bfeel(ing)? sick\b/i],
  },
  { symptomId: 'vomiting', strong: [/\bvomit\w*\b/i, /\bthrowing up\b/i, /\bthrew up\b/i, /\bbeen sick\b/i] },
  {
    symptomId: 'rectal_bleeding',
    requireAll: [[/\bblood\w*\b/i], [/\bstool\b/i, /\bbowel movements?\b/i, /\bpoop\w*\b/i, /\bbathroom\b/i, /\btoilet\b/i]],
  },
  {
    symptomId: 'bowel_urgency',
    strong: [/\bbowel urgency\b/i, /\bsudden(ly)? need\w* (the|to use the) (bathroom|toilet)\b/i, /\brush(ed|ing)? to the (bathroom|toilet)\b/i],
  },

  // --- Urinary --------------------------------------------------------------
  {
    symptomId: 'dysuria',
    strong: [/\bdysuria\b/i],
    requireAll: [[/\bpee\b/i, /\burinat\w*/i, /\burine\b/i, /\bwee\b/i, /\bwidow?/i], [/\bpain\w*\b/i, /\bburn\w*\b/i, /\bsting\w*\b/i, /\bhurts?\b/i]],
  },
  { symptomId: 'bladder_pain', requireAll: [[/\bbladder\b/i], [/\bpain\w*\b/i, /\bache[sd]?\b/i, /\bpressure\b/i]] },
  {
    symptomId: 'urinary_urgency',
    strong: [/\burinary urgency\b/i, /\bsudden(ly)? need\w* (to pee|to urinate)\b/i, /\bcan'?t hold (my|it)\b/i],
  },
  {
    symptomId: 'urinary_frequency',
    strong: [/\bpeeing (a lot|constantly|all the time)\b/i, /\burinary frequency\b/i, /\bpee (a lot|often|constantly)\b/i],
  },
  { symptomId: 'incomplete_emptying', strong: [/\b(can'?t|trouble|difficult\w*) (fully )?empt\w* (my )?bladder\b/i] },
  { symptomId: 'haematuria', requireAll: [[/\bblood\w*\b/i], [/\burine\b/i, /\bpee\b/i, /\bwee\b/i]] },

  // --- Systemic -------------------------------------------------------------
  {
    symptomId: 'fatigue',
    strong: [
      /\bexhaust\w*\b/i,
      /\bfatigu\w*\b/i,
      /\bno energy\b/i,
      /\bdrained\b/i,
      /\bworn out\b/i,
      /\bcan'?t (get out of bed|stay awake)\b/i,
    ],
  },
  { symptomId: 'dizziness', strong: [/\bdizz\w*\b/i, /\blight[- ]?headed\b/i] },
  { symptomId: 'headache', strong: [/\bheadache\w*\b/i, /\bmigraine\w*\b/i] },
  {
    symptomId: 'sleep_disturbance',
    strong: [/\bcan'?t sleep\b/i, /\btrouble sleeping\b/i, /\binsomnia\b/i, /\bwaking up (a lot|multiple times|constantly)\b/i, /\bdisturbed sleep\b/i],
  },
  {
    symptomId: 'low_mood',
    strong: [/\blow mood\b/i, /\bfeeling down\b/i, /\bdepress\w*\b/i, /\bhopeless\b/i, /\btearful\b/i],
  },

  // --- Sexual (opt-in domain; matched only if mentioned unprompted) ---------
  {
    symptomId: 'dyspareunia',
    strong: [/\bdyspareunia\b/i, /\bpainful (sex|intercourse)\b/i, /\bpain during (sex|intercourse)\b/i, /\bsex hurts?\b/i],
    requireAll: [[/\bsex\b/i, /\bintercourse\b/i], [/\bpainful\b/i, /\bpain\w*\b/i, /\bhurts?\b/i, /\bhurt(ing)?\b/i]],
  },
  {
    symptomId: 'post_coital_pain',
    strong: [/\bpain after (sex|intercourse)\b/i, /\bpost[- ]coital pain\b/i, /\bhurts? after (sex|intercourse)\b/i],
  },
  {
    symptomId: 'intimacy_avoidance',
    strong: [/\bavoid\w* (sex|intimacy|intercourse)\b/i, /\bafraid to have sex\b/i],
  },

  // --- Extrapelvic (rare) -----------------------------------------------
  { symptomId: 'cyclical_shoulder_pain', requireAll: [[/\bshoulder\b/i], [/\bpain\w*\b/i, /\bache[sd]?\b/i]] },
  { symptomId: 'cyclical_chest_pain', requireAll: [[/\bchest\b/i], [/\bpain\w*\b/i, /\bache[sd]?\b/i, /\btight\w*\b/i]] },
  { symptomId: 'cyclical_cough', strong: [/\bcough\w*\b/i] },
  { symptomId: 'scar_pain', requireAll: [[/\bscar\b/i], [/\bpain\w*\b/i, /\bswell\w*\b/i, /\bache[sd]?\b/i]] },
  { symptomId: 'breathlessness', strong: [/\bbreathless\w*\b/i, /\bshort(ness)? of breath\b/i, /\bcan'?t breathe\b/i] },
]

/**
 * Negation cues. Scope is the clause the match was found in (see nlp.ts) — a
 * deliberately simple, documented limitation rather than full dependency parsing.
 */
export const NEGATION_CUES: RegExp[] = [
  /\bno\b/i,
  /\bnot\b/i,
  /\bnone\b/i,
  /\bnever\b/i,
  /\bdenies?\b/i,
  /\bdenied\b/i,
  /\bwithout\b/i,
  /\bdidn'?t\b/i,
  /\bdid not\b/i,
  /\bdoesn'?t\b/i,
  /\bdoes not\b/i,
  /\bdon'?t\b/i,
  /\bdo not\b/i,
  /\bhasn'?t\b/i,
  /\bhas not\b/i,
  /\bhaven'?t\b/i,
  /\bhave not\b/i,
  /\bisn'?t\b/i,
  /\bis not\b/i,
  /\bwasn'?t\b/i,
  /\bwas not\b/i,
  /\bfree of\b/i,
]

/**
 * Severity modifiers, ordered strongest first. The first pattern that matches the
 * clause wins — this is a lexicon lookup, not a learned scale, so ties are broken by
 * list order rather than any notion of "best" match.
 */
export const SEVERITY_LEXICON: { pattern: RegExp; score: number }[] = [
  { pattern: /\bunbearable\b/i, score: 10 },
  { pattern: /\bexcruciating\b/i, score: 10 },
  { pattern: /\bworst\b/i, score: 10 },
  { pattern: /\bagoni[sz]ing\b/i, score: 9 },
  { pattern: /\bcan'?t function\b/i, score: 9 },
  { pattern: /\bcouldn'?t (move|get up|function)\b/i, score: 9 },
  { pattern: /\bextremely\b/i, score: 8 },
  { pattern: /\bsever(e|ely)\b/i, score: 8 },
  { pattern: /\bterrible\b/i, score: 8 },
  { pattern: /\bhorrible\b/i, score: 8 },
  { pattern: /\bawful\b/i, score: 8 },
  { pattern: /\bintense\b/i, score: 8 },
  { pattern: /\breally bad\b/i, score: 7 },
  { pattern: /\bvery bad\b/i, score: 7 },
  { pattern: /\bquite bad\b/i, score: 6 },
  { pattern: /\bpretty bad\b/i, score: 6 },
  { pattern: /\bsignificant\w*\b/i, score: 6 },
  { pattern: /\bconstant\w*\b/i, score: 6 },
  { pattern: /\bmoderate\w*\b/i, score: 5 },
  { pattern: /\bnoticeable\b/i, score: 4 },
  { pattern: /\buncomfortable\b/i, score: 4 },
  { pattern: /\bmild\w*\b/i, score: 3 },
  { pattern: /\bslight\w*\b/i, score: 3 },
  { pattern: /\ba little\b/i, score: 2 },
  { pattern: /\ba bit\b/i, score: 2 },
  { pattern: /\bminor\b/i, score: 2 },
  { pattern: /\bmanageable\b/i, score: 3 },
]

/** Neutral default when a symptom is described without a severity cue. */
export const DEFAULT_INFERRED_SEVERITY = 5

export const MENSTRUAL_CONTEXT_CUES: RegExp[] = [
  /\bperiods?\b/i,
  /\bmenstruat\w*\b/i,
  /\bon my period\b/i,
  /\bduring my period\b/i,
  /\bwhile (i'?m|i am) on my period\b/i,
]

export const RECENT_ONSET_CUES: RegExp[] = [
  /\blately\b/i,
  /\brecently\b/i,
  /\bthis week\b/i,
  /\bthe past (few )?days?\b/i,
  /\bstarted\b/i,
  /\bnew\b/i,
  /\bsince\b/i,
  /\bthese days\b/i,
]

/** Captures "for 3 days" / "for a week" style duration mentions, for display only. */
export const DURATION_PATTERN =
  /\bfor (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) (day|days|week|weeks|month|months)\b/i
