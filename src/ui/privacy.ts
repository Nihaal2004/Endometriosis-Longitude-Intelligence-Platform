/**
 * privacy.ts — the privacy notice and its version.
 *
 * Every consent record stores NOTICE_VERSION, so it is always possible to say
 * exactly what wording a patient agreed to. Change the text → bump the version.
 *
 * GRIEVANCE_CONTACT must be a real, named person before any real patient is
 * enrolled (DPDP Act 2023). It is deliberately a visible placeholder until then.
 */

export const NOTICE_VERSION = '2026-10-draft'

export const GRIEVANCE_CONTACT = {
  name: '[Grievance officer — to be named before the pilot]',
  email: '[contact email — to be set before the pilot]',
}

export interface ConsentPurposeCopy {
  id: 'core_tracking' | 'sexual_health_module' | 'fertility_module' | 'research_use'
  title: string
  body: string
  required: boolean
}

export const CONSENT_PURPOSES: ConsentPurposeCopy[] = [
  {
    id: 'core_tracking',
    title: 'Keep my symptom record',
    body: 'Store the symptoms, bleeding, medication and appointments I log, so the app can show me patterns and prepare a report I choose to share.',
    required: true,
  },
  {
    id: 'sexual_health_module',
    title: 'Sexual-health questions',
    body: 'Let me record pain during or after sex. Off unless I turn it on. Never included in a shared report unless I tick it each time.',
    required: false,
  },
  {
    id: 'fertility_module',
    title: 'Fertility information',
    body: 'Let me record fertility concerns and treatment. Off unless I turn it on.',
    required: false,
  },
  {
    id: 'research_use',
    title: 'Help research (de-identified)',
    body: 'Allow my de-identified data to be used to improve how endometriosis symptoms are understood. Off by default. Nothing is used for research today; you would be asked again before any study.',
    required: false,
  },
]

export const PRIVACY_SECTIONS: { heading: string; body: string[] }[] = [
  {
    heading: 'What MedTrace is',
    body: [
      'MedTrace helps you keep a record of endometriosis-related symptoms over time and turn it into a short report you can take to an appointment.',
      'It does not diagnose any condition, does not estimate your risk of one, and is not a substitute for medical care. If you have severe or sudden symptoms, seek medical help.',
    ],
  },
  {
    heading: 'What we collect',
    body: [
      'Your email address and a password, to sign you in. We do not ask for your name, date of birth, address, phone number or any government ID.',
      'The health information you choose to log: bleeding, symptoms and their severity, how symptoms affected your day, medication, treatments and appointments, and notes.',
      'A record of the consents you give or withdraw, and of when a report you shared was viewed.',
    ],
  },
  {
    heading: 'How it is used',
    body: [
      'Only to show you your own patterns and to produce reports you decide to share. The calculations run on your own device.',
      'We do not sell your data, show advertising, or use your data to train AI models.',
    ],
  },
  {
    heading: 'Where it is stored',
    body: [
      'On your device, and on secured servers in India (Mumbai). Access to your records is restricted to your account by the database itself.',
    ],
  },
  {
    heading: 'Sharing',
    body: [
      'Nothing leaves your account unless you create a share link. You choose which sections a link includes and preview the exact report first. Links expire after 7 or 30 days and you can revoke them at any time.',
    ],
  },
  {
    heading: 'Your rights',
    body: [
      'You can see and correct everything you have logged, download a copy of all of it, withdraw any consent, and delete your account — which permanently erases your data. All of this is in the Me tab.',
      'Withdrawing consent is as easy as giving it, and does not affect anything done before you withdrew it.',
    ],
  },
  {
    heading: 'Questions and complaints',
    body: [
      `Contact our grievance officer: ${GRIEVANCE_CONTACT.name}, ${GRIEVANCE_CONTACT.email}. If you are not satisfied with the response, you may complain to the Data Protection Board of India.`,
    ],
  },
]
