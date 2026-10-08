import { SYMPTOMS } from '../engine/symptoms'
import type { PatientRecord } from '../engine/types'
export function symptomDefinitions(record: PatientRecord) { return [...SYMPTOMS, ...(record.customSymptoms ?? [])] }
