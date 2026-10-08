# Patient guide

For installation, follow the [root README](../README.md). Open
http://127.0.0.1:8765 after starting the application with `npm start`.

## Create an account

Choose **Create account**, enter a display name and local username, and choose a
password of 10–128 characters. Usernames use letters, numbers, dots, underscores,
and dashes. Local health storage permission is required to create a record;
analysis permission is optional. Report permission is configured separately.

Save the recovery code shown after registration. There is no email password reset.
**Forgot your password?** requires your username and recovery code and issues a new
recovery code after a successful reset. Changing or recovering a password signs
out existing sessions.

Complete profile setup: baseline history and cycle context, symptom domains and
tracked symptoms, then reminder preferences. Optional fields can remain unanswered.
Update the profile later from **Health profile**.

## Explore a trial

Select **Explore a trial session** on the sign-in page, acknowledge fictional data,
and choose Maya, Priya, or Aisha. Each example illustrates a different history and
evidence quality. Trial accounts are isolated from personal accounts. Switching
examples replaces the trial's working record.

**End trial & erase sample** deletes the trial account and associated data. Trials
also expire and are cleaned up on requests and periodically while the server runs.
Downloaded files remain separate copies. Personal accounts survive sign-out.

## Record a day

Open **Daily check-in**, choose the date, and select an entry depth:

| Depth | Available information |
|---|---|
| Quick | Bleeding, symptom observations, severity, and daily impact |
| Standard | Medication, affected activities, and a daily note in addition to core answers |
| Detailed | Pain location, character, timing, duration, triggers, response, and medication relief |

Each symptom is **Present**, **Absent**, or **Unknown / unanswered**. Unknown is
never interpreted as symptom-free. Severity is optional and belongs to a present
symptom. Empty confirmed medication lists mean none taken; unanswered medication
questions remain unknown. Save the entry explicitly. Recent entries can be reopened
and edited; removing an entry changes the working record but not retained revisions.

The optional text helper matches phrases locally and proposes structured answers.
Review and confirm suggestions before saving. It is not a generative AI assistant
and does not infer a diagnosis. Unsaved drafts are not persisted across reloads.

## Personalize the record

In **Settings & privacy**, add custom symptoms with your own wording, a domain,
optional standard-symptom mapping, and severity preference. Edit, archive, or restore
these definitions. Archived symptoms retain their historical observations.
Medication shortcuts make daily logging faster; they do not prescribe treatment.

A reminder uses a generic browser notification at the saved time. Browser permission
is required, and the app must remain open. There is no native background scheduler.

## Add treatments, visits, and documents

Use **Treatments & visits** to add or edit treatment dates, doses, reasons, side
effects, and perceived changes, or record visits, referrals, investigations, surgery,
and diagnoses. Optional dates and details describe patient-reported history.

Attach PDF, PNG, or JPEG documents of up to 5 MB to an existing healthcare event.
Attachments are encrypted locally and excluded from clinical reports. Removing the
related event also deletes its attachments.

## Review insights

**Overview**, **Insights**, and **My timeline** summarize saved observations when
analysis permission is enabled. Select a window of 30, 92, 188, or 365 days.
Descriptive counts can appear before enough evidence exists for longitudinal
findings. Missing dates remain unknown, and insufficient evidence suppresses claims.
Cycle alignment is retrospective, not a future cycle prediction.

## Prepare a clinical visit

1. Enable analysis and report permissions in Settings.
2. Open **Prepare a clinical visit** and select dates, symptom domains, and summary
   sections. Choose whether to include cycle context, treatments, and healthcare
   history. Sexual health, fertility, and private notes/episode details start excluded.
3. Optionally add the visit date and questions for the clinician.
4. Generate a preview. The local server computes the report from the selected scope
   and verifies numerical assertions. Inspect statements using **View evidence**.
5. Confirm review and save the report. If the underlying record changes, generate
   and review another preview before saving. Previews expire after one hour.
6. Download the PDF or open it later in **My reports**. Saved reports retain their
   original evidence unless explicitly erased with associated domain/account data.

Visit links last between one hour and seven days and can be revoked. They work
only on this computer. For a clinician elsewhere, provide the downloaded PDF.
Withdrawing report permission blocks exports and existing visit links; it cannot
recall copies already downloaded.

## Privacy and deletion

Storage permission controls new record writes. Analysis permission controls insights
and new reports. Report permission controls approval, PDF export, and visit links.
Withdrawing a permission does not itself erase existing records.

Disabling a symptom domain stops new collection. **Erase a symptom domain** removes
its structured observations and definitions from retained revisions, deletes affected
reports/links, and clears previews. It does not remove free-text mentions, documents,
or exported copies. Account deletion removes all associated local database data;
exports and OS backups remain separate.

**Download my data** exports current and retained records, documents, consent
history, and activity in plain JSON. Reviewed reports are included only with report
permission. Export is not an automated account restore feature.

Sessions have a 12-hour maximum duration and lock after 30 minutes without activity.
Sign out when leaving a shared computer. If symptoms need urgent attention, seek
clinical help; MedTrace does not assess emergencies.
