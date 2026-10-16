-- =============================================================================
-- Clinical wording for patient-described symptoms
--
-- A patient can describe a symptom in their own words. With consent, the
-- interpret-symptom edge function suggests the clinical term a gynaecologist
-- expects; the patient confirms it before anything is stored. The report shows
-- the term with the patient's own words beside it, never the term alone.
-- =============================================================================

-- No digits: the brief's fidelity gate audits every number in the prose, and a
-- label must never be able to introduce one.
alter table public.custom_symptoms
  add column clinical_term text
  check (clinical_term is null or (char_length(clinical_term) between 2 and 80 and clinical_term !~ '[0-9]'));

-- A separate, opt-in purpose: the description is read by a language model
-- (MedGemma, on a server we run), which the patient should choose knowingly.
alter table public.consents drop constraint consents_purpose_check;
alter table public.consents add constraint consents_purpose_check check (purpose in (
  'core_tracking', 'sexual_health_module', 'fertility_module', 'research_use', 'ai_symptom_wording'));
