/**
 * reportPdf.ts — the report as a PDF, built from the same snapshot as the share link.
 *
 * Generated as real text, not a screenshot, so it is searchable, small, and reads
 * correctly in a clinic's document system. window.print() does nothing inside an
 * Android WebView, so on phones this is the "Print / PDF" path.
 */

import { jsPDF } from 'jspdf'
import { formatDateLong } from '../../engine/brief'
import type { SharedReport } from './snapshot'

const STATUS: Record<NonNullable<SharedReport['patient']['diagnosisStatus']>, string> = {
  confirmed: 'Endometriosis confirmed',
  suspected: 'Suspected endometriosis',
  undiagnosed: 'Not yet diagnosed',
}

/** jsPDF's built-in fonts are Latin-1; map the typographic characters we use. */
function latin(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/κ/g, 'kappa')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '')
}

export function buildReportPdf(report: SharedReport): Blob {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const margin = 54
  const width = doc.internal.pageSize.getWidth() - margin * 2
  const bottom = doc.internal.pageSize.getHeight() - margin
  let y = margin

  const ensure = (needed: number) => {
    if (y + needed > bottom) {
      doc.addPage()
      y = margin
    }
  }

  const write = (text: string, size: number, opts: { bold?: boolean; color?: number; gap?: number } = {}) => {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    doc.setTextColor(opts.color ?? 30)
    const lines = doc.splitTextToSize(latin(text), width) as string[]
    const lineHeight = size * 1.4
    for (const line of lines) {
      ensure(lineHeight)
      doc.text(line, margin, y + size)
      y += lineHeight
    }
    y += opts.gap ?? 0
  }

  const heading = (text: string) => {
    ensure(40)
    y += 10
    write(text.toUpperCase(), 8.5, { bold: true, color: 120, gap: 4 })
  }

  const p = report.period
  const coverage = p.calendarDays > 0 ? Math.round((p.loggedDays / p.calendarDays) * 100) : 0

  write('PATIENT-REPORTED SYMPTOM SUMMARY', 8.5, { bold: true, color: 120, gap: 2 })
  write('Longitudinal symptom summary', 20, { bold: true, gap: 4 })
  write([report.patient.displayName, report.patient.diagnosisStatus && STATUS[report.patient.diagnosisStatus]].filter(Boolean).join(' · '), 10.5, { color: 80 })
  write(
    `${formatDateLong(p.start)} - ${formatDateLong(p.end)} · ${p.loggedDays} of ${p.calendarDays} days logged (${coverage}%) · ${p.completeCycles} complete cycle${p.completeCycles === 1 ? '' : 's'}`,
    9.5,
    { color: 110, gap: 6 },
  )
  doc.setDrawColor(40)
  doc.setLineWidth(1.2)
  doc.line(margin, y, margin + width, y)
  y += 8

  if (report.concerns?.length) {
    heading('Main concerns')
    report.concerns.forEach((c, i) => write(`${i + 1}.  ${c}`, 11))
    if (report.patient.priorLabels?.length) write(`Previous labels: ${report.patient.priorLabels.join('; ')}`, 10, { color: 80 })
  }

  if (report.summary?.length) {
    heading('Summary in plain words')
    write(report.summary.join(' '), 11, { gap: 2 })
    write('Written by an AI from the findings below. Every number in it was checked against the patient’s entries.', 9, { color: 110 })
  }

  for (const s of report.sections) {
    heading(s.title)
    for (const c of s.claims) write(c.text, 11, { gap: 5 })
  }

  if (report.background?.length) {
    heading('Background')
    for (const l of report.background) write(`${l.label}: ${l.value}`, 10.5, { gap: 2 })
  }

  if (report.treatments?.length) {
    heading('Treatments')
    for (const t of report.treatments) {
      write(`${t.label} - ${formatDateLong(t.startDate)} to ${t.endDate ? formatDateLong(t.endDate) : 'ongoing'}`, 10.5)
    }
  }

  if (report.timeline?.length) {
    heading('Appointments and tests')
    for (const e of report.timeline) {
      write(`${formatDateLong(e.date)} - ${e.label}${e.reason ? ` (${e.reason})` : ''}${e.outcome ? `: ${e.outcome}` : ''}`, 10.5, { gap: 2 })
    }
  }

  y += 10
  write(report.safetyStatement, 9, { color: 90 })

  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(140)
    doc.text(
      `MedTrace · patient-reported · generated ${formatDateLong(report.createdAt.slice(0, 10))} · page ${i} of ${pages}`,
      margin,
      doc.internal.pageSize.getHeight() - 28,
    )
  }

  return doc.output('blob')
}
