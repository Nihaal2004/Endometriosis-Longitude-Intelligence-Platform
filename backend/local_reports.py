"""Trusted local report computation and clinical-visit PDF output."""
import io
import json
from pathlib import Path
import shutil
import subprocess
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent.parent


def compute_report(record, scope):
    from datetime import date
    from medtrace_db.database import check_text
    if not isinstance(scope, dict):
        raise ValueError('Choose the report scope')
    start, end = scope.get('start'), scope.get('end')
    if date.fromisoformat(start).isoformat() != start or date.fromisoformat(end).isoformat() != end or start > end or date.fromisoformat(end) > date.today() or (date.fromisoformat(end) - date.fromisoformat(start)).days > 3660:
        raise ValueError('Choose a valid report window of at most ten years')
    domains = scope.get('domains')
    if not isinstance(domains, list) or not domains or any(d not in ('pain', 'bowel', 'urinary', 'systemic', 'sexual', 'extrapelvic') for d in domains):
        raise ValueError('Choose at least one symptom domain')
    sections = scope.get('sections')
    if not isinstance(sections, list) or any(s not in ('findings', 'impact', 'medication', 'change') for s in sections):
        raise ValueError('Invalid report sections')
    for flag in ('treatments', 'events', 'cycle', 'fertility', 'privateNotes'):
        if type(scope.get(flag)) is not bool:
            raise ValueError('Report scope requires explicit inclusion choices')
    node = shutil.which('node')
    cli = ROOT / 'node_modules' / 'tsx' / 'dist' / 'cli.mjs'
    if node is None or not cli.exists():
        raise RuntimeError('Install Node.js and run npm install before generating reports')
    try:
        completed = subprocess.run([node, str(cli), str(ROOT / 'src' / 'engine' / 'local-report.ts')],
        input=json.dumps({'record': record, 'scope': scope}, allow_nan=False),
        text=True, encoding='utf-8', capture_output=True, cwd=ROOT, timeout=60)
    except subprocess.TimeoutExpired:
        raise RuntimeError('Report computation timed out. Try a shorter report window.')
    if completed.returncode:
        raise RuntimeError('Local report computation failed; the source record has not been changed')
    report = json.loads(completed.stdout)
    check_text(report['engineVersion'], 'Engine version', 100)
    return report


def pdf_bytes(report):
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.pagesizes import A4
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, KeepTogether
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    font = 'Helvetica'
    for candidate in (Path('C:/Windows/Fonts/arial.ttf'), Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')):
        if candidate.exists():
            if 'MedTraceText' not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont('MedTraceText', str(candidate)))
            font = 'MedTraceText'
            break
    styles = getSampleStyleSheet()
    for style in styles.byName.values():
        style.fontName = font
        style.alignment = TA_LEFT
    styles['Normal'].fontSize = 9
    styles['Normal'].leading = 13
    styles['Heading2'].fontSize = 11
    styles['Heading2'].textColor = colors.HexColor('#225F55')
    stream = io.BytesIO()
    document = SimpleDocTemplate(stream, pagesize=A4, rightMargin=38, leftMargin=38, topMargin=35, bottomMargin=35,
        title='MedTrace clinical visit report', author='MedTrace')
    def paragraph(value, style='Normal'):
        return Paragraph(escape(str(value)).replace('\n', '<br/>'), styles[style])
    story = [paragraph('MedTrace · Clinical visit report', 'Title'), paragraph('Patient-reported longitudinal symptom history')]
    profile = report['profile']
    story += [paragraph(f"{profile['displayName']} · {profile.get('ageRange', '')} · {profile['diagnosisStatus']}"),
        paragraph(f"Recorded period: {report['windowStart']} to {report['windowEnd']}"), Spacer(1, 12)]
    if report.get('visitDate'):
        story.append(paragraph(f"Clinical visit: {report['visitDate']}"))
    if report.get('scope', {}).get('events'):
        baseline = []
        if profile.get('symptomOnsetYear'):
            baseline.append(f"Symptoms reported since {profile['symptomOnsetYear']}")
        for field, title in (('familyHistory', 'Family history'), ('previousPelvicSurgery', 'Previous pelvic surgery')):
            if profile.get(field) is not None:
                baseline.append(title + (': reported' if profile[field] else ': not reported'))
        if baseline:
            story += [paragraph('Baseline history', 'Heading2'), paragraph('; '.join(baseline))]
    if report.get('patientNote'):
        story += [paragraph('Questions for my visit', 'Heading2'), paragraph(report['patientNote'])]
    if report.get('concerns'):
        story += [paragraph('Main concerns', 'Heading2')] + [paragraph('• ' + c) for c in report['concerns']]
    if profile.get('priorLabels'):
        story.append(paragraph('Patient-reported previous labels: ' + '; '.join(profile['priorLabels'])))
    sections = {'period': 'Record and coverage', 'findings': 'Longitudinal findings', 'impact': 'Functional impact', 'change': 'Changes over time', 'medication': 'Medication and treatment', 'quality': 'Data quality'}
    for key, title in sections.items():
        claims = [c for c in report['claims'] if c['section'] == key]
        if claims:
            story += [paragraph(title, 'Heading2')] + [paragraph(c['text']) for c in claims]
    if report.get('treatments'):
        story.append(paragraph('Patient-reported treatments', 'Heading2'))
        for treatment in report['treatments']:
            description = f"{treatment['label']} · {treatment['startDate']} to {treatment.get('endDate') or 'ongoing'}"
            for field, title in (('dose', 'Dose/schedule'), ('reason', 'Reason'), ('patientPerceivedChange', 'Perceived change')):
                if treatment.get(field): description += f"; {title}: {treatment[field]}"
            if treatment.get('sideEffects'): description += '; Reported side effects: ' + '; '.join(treatment['sideEffects'])
            story.append(paragraph(description))
    medications = sorted({m['label'] + (' · ' + m['dose'] if m.get('dose') else '') for day in report['sourceRecord']['days'] if report['windowStart'] <= day['date'] <= report['windowEnd'] for m in (day.get('medications') or [])})
    if medications:
        story += [paragraph('Medication recorded during this period', 'Heading2')] + [paragraph(m) for m in medications]
    if report.get('clinicalEvents'):
        story.append(paragraph('Healthcare timeline', 'Heading2'))
        for event in sorted(report['clinicalEvents'], key=lambda e: e['date']):
            story.append(paragraph(f"{event['date']} · {event['label']}" + (f" — {event['outcome']}" if event.get('outcome') else '')))
    if report.get('scope', {}).get('privateNotes'):
        notes = [d for d in report['sourceRecord']['days'] if (d.get('note') or d.get('episode')) and report['windowStart'] <= d['date'] <= report['windowEnd']]
        if notes:
            story += [paragraph('Patient-selected notes', 'Heading2')] + [paragraph(f"{d['date']}: {d.get('note') or ''}" + ('; ' + '; '.join(f'{key}: {value}' for key, value in d.get('episode', {}).items() if value is not None and value != '') if d.get('episode') else '')) for d in notes]
    story += [Spacer(1, 12), paragraph(report.get('safetyStatement', 'This report does not diagnose disease or replace clinical judgement.'))]
    def footer(canvas, doc):
        canvas.setFont(font, 8)
        canvas.drawString(38, 20, f'MedTrace · Reviewed record revision {report.get("recordRevision", "")}')
        canvas.drawRightString(A4[0] - 38, 20, str(doc.page))
    document.build(story, onFirstPage=footer, onLaterPages=footer)
    return stream.getvalue()
