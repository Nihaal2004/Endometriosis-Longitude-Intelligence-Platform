import { readFileSync } from 'node:fs'
import { buildFeatureContext } from './features'
import { runPatternEngine } from './patterns'
import { generateBrief, mainConcerns, SAFETY_STATEMENT } from './brief'
import { applyFidelityGate, verifyBrief } from './fidelity'
import type { PatientRecord, SymptomDomain } from './types'
import { SYMPTOMS } from './symptoms'

// Invoked locally by Python with JSON on stdin. No network or external AI.
const input = JSON.parse(readFileSync(0, 'utf8'))
const record: PatientRecord = input.record
const scope: { domains: SymptomDomain[]; sections: string[]; start: string; end: string; treatments: boolean; events: boolean; cycle: boolean; fertility: boolean; privateNotes: boolean } = input.scope
const definitions = [...SYMPTOMS, ...(record.customSymptoms ?? [])]
const ids = new Set(definitions.filter(s => scope.domains.includes(s.domain)).map(s => s.id))
const clinicalEvents = scope.events ? record.clinicalEvents.filter(e => scope.fertility || e.kind !== 'fertility') : []
const treatments = scope.treatments ? record.treatments.filter(t => t.startDate <= scope.end && (scope.fertility || t.kind !== 'fertility')).map(t=>({...t,indicationSymptomId:t.indicationSymptomId && ids.has(t.indicationSymptomId) ? t.indicationSymptomId : undefined})) : []
const scoped: PatientRecord = {
  ...record, profile: { ...record.profile, enabledDomains: scope.domains, priorLabels: scope.events ? record.profile.priorLabels : undefined, symptomOnsetYear: scope.events ? record.profile.symptomOnsetYear : undefined, familyHistory: scope.events ? record.profile.familyHistory : undefined, previousPelvicSurgery: scope.events ? record.profile.previousPelvicSurgery : undefined, usualCycleLength: scope.cycle ? record.profile.usualCycleLength : undefined, cycleRegularity: scope.cycle ? record.profile.cycleRegularity : undefined, ageAtMenarche: scope.cycle ? record.profile.ageAtMenarche : undefined, reminderTime: undefined },
  days: record.days.map(day => ({ ...day, bleeding: scope.cycle ? day.bleeding : undefined, symptoms: Object.fromEntries(Object.entries(day.symptoms).filter(([id]) => ids.has(id))),
    medications: scope.treatments ? day.medications : undefined,
    note: scope.privateNotes ? day.note : undefined, episode: scope.privateNotes ? day.episode : undefined })),
  trackedSymptomIds: record.trackedSymptomIds.filter(id => ids.has(id)),
  customSymptoms: record.customSymptoms?.filter(s => ids.has(s.id)), clinicalEvents, treatments,
  medicationList: scope.treatments ? record.medicationList : [],
}
const labels = Object.fromEntries((scoped.customSymptoms ?? []).map(s => [s.id, s.label]))
const ctx = buildFeatureContext(scoped, { start: scope.start, end: scope.end })
const patterns = runPatternEngine(ctx)
const brief = generateBrief(ctx, patterns.findings, patterns.suppressed, { maxFindings: 6, persistenceFloor: .2, kappaFloor: .21, customLabels: labels })
const fidelity = verifyBrief(brief.claims, scoped, scope.start, scope.end)
const { kept } = applyFidelityGate(brief.claims, fidelity)
const claims = kept.filter(c => c.section === 'period' || c.section === 'quality' || scope.sections.includes(c.section))
const findingIds = new Set(claims.map(c => c.findingId))
process.stdout.write(JSON.stringify({ claims, findings: patterns.findings.filter(f => findingIds.has(f.id)), concerns: mainConcerns(ctx, 4, labels),
  windowStart: scope.start, windowEnd: scope.end, sourceRecord: scoped, profile: scoped.profile,
  clinicalEvents: clinicalEvents.filter(e => e.date <= scope.end), treatments,
  scope, engineVersion: 'local-1.0', safetyStatement: SAFETY_STATEMENT, fidelity,
  coverage: ctx.coverage, loggedDays: ctx.loggedDays, calendarDays: ctx.calendarDays }))
