/**
 * privacy.ts — the privacy notice and its version.
 *
 * Every consent record stores NOTICE_VERSION, so it is always possible to say
 * exactly what wording a patient agreed to. Change the text → bump the version.
 *
 * GRIEVANCE_CONTACT must name a real person before any real patient is enrolled
 * (DPDP Act 2023). Until then it is null and the notice says so plainly.
 */

export const NOTICE_VERSION = '2026-10-draft-3'

export const GRIEVANCE_CONTACT = null as { name: string; email: string } | null

export interface ConsentPurposeCopy {
  id: 'core_tracking' | 'sexual_health_module' | 'fertility_module' | 'research_use' | 'ai_symptom_wording'
  title: string
  body: string
  required: boolean
}

export const CONSENT_PURPOSES: ConsentPurposeCopy[] = [
  {
    id: 'core_tracking',
    title: 'Keep my symptom record',
    body: 'Save what I log so I can see my patterns and make a report.',
    required: true,
  },
  {
    id: 'sexual_health_module',
    title: 'Sexual-health questions',
    body: 'Let me log pain during or after sex. Only shared if I choose to each time.',
    required: false,
  },
  {
    id: 'fertility_module',
    title: 'Fertility information',
    body: 'Let me log fertility concerns and treatment.',
    required: false,
  },
  {
    id: 'ai_symptom_wording',
    title: 'Suggest medical terms',
    body: 'When I describe a symptom in my own words, an AI suggests the term a doctor would use. I decide whether to keep it.',
    required: false,
  },
  {
    id: 'research_use',
    title: 'Help research',
    body: 'Allow my data, with my identity removed, to be used for research. I will be asked again before any study.',
    required: false,
  },
]

export const PRIVACY_SECTIONS: { heading: string; body: string[] }[] = [
  {
    heading: 'What MedTrace is',
    body: [
      'MedTrace helps you track endometriosis-related symptoms and turn them into a short report for your doctor.',
      'It does not diagnose anything and is not a replacement for medical care. If your symptoms are severe or sudden, get medical help.',
    ],
  },
  {
    heading: 'What we collect',
    body: [
      'Your email and password, to sign you in. We never ask for your address, phone number or any ID.',
      'The health information you choose to log, such as bleeding, symptoms, medication, appointments and notes.',
      'A record of the consents you give or withdraw, and of when a report you shared was opened.',
    ],
  },
  {
    heading: 'How it is used',
    body: [
      'Only to show you your own patterns and to make reports you choose to share. The analysis runs on your own device.',
      'We do not sell your data, show ads, or use your data to train AI models.',
    ],
  },
  {
    heading: 'Where it is stored',
    body: [
      'On your device and on secure servers in India (Mumbai). Only your account can access your records.',
      'If you turn on medical-term suggestions, only the words you type to describe a symptom are read by an AI model that MedTrace runs itself. They are not sent to any other company.',
    ],
  },
  {
    heading: 'Sharing',
    body: [
      'Nothing is shared unless you create a share link. You pick what it includes and see it first. Links expire after 7 or 30 days, and you can cancel them at any time.',
    ],
  },
  {
    heading: 'Your rights',
    body: [
      'In the Me tab you can correct your logs, download all your data, withdraw any consent, or delete your account and everything in it.',
      'Withdrawing consent is as easy as giving it.',
    ],
  },
  {
    heading: 'Questions and complaints',
    body: [
      GRIEVANCE_CONTACT
        ? `Contact our grievance officer, ${GRIEVANCE_CONTACT.name}, at ${GRIEVANCE_CONTACT.email}. If you are not satisfied with the answer, you can complain to the Data Protection Board of India.`
        : 'The name and email of our grievance officer will be added here before MedTrace opens to patients. You can also complain to the Data Protection Board of India.',
    ],
  },
]
