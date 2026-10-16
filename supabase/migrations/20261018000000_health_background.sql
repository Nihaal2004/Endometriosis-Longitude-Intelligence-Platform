-- =============================================================================
-- Health background: the rest of the baseline profile
--
-- Asked once (or updated now and then) in Me, never daily, and every field is
-- optional: null means "not answered", never "no". Fertility and pregnancy
-- answers are part of the patient's own report but stay out of a share link
-- unless she includes them for that link.
-- =============================================================================

alter table public.profiles
  -- General clinical context
  add column health_conditions        text[] not null default '{}'
    check (cardinality(health_conditions) <= 20),
  -- Menstrual baseline
  add column typical_bleeding_days    int  check (typical_bleeding_days between 1 and 15),
  add column heavy_bleeding           text check (heavy_bleeding in ('yes', 'no', 'unsure')),
  add column spotting_between_periods text check (spotting_between_periods in ('yes', 'no', 'unsure')),
  add column last_period_start        date,
  add column hormonal_contraception   text check (hormonal_contraception in ('current', 'past', 'never')),
  add column treatment_amenorrhoea    boolean,
  -- Fertility and pregnancy (optional, sensitive)
  add column pregnancy_history        text check (pregnancy_history in ('never', 'previous', 'prefer_not')),
  add column pregnancy_possible       text check (pregnancy_possible in ('yes', 'no', 'unsure')),
  add column fertility_concerns       text check (fertility_concerns in ('yes', 'no', 'unsure')),
  add column reproductive_goals       text check (reproductive_goals in ('trying', 'later', 'not_planning', 'unsure')),
  add column fertility_treatment      text check (fertility_treatment in ('current', 'past', 'never'));

-- Each condition is a short label the patient typed, never a document.
create function public.health_conditions_valid(v text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(char_length(c) between 1 and 80), true) from unnest(v) as c
$$;

alter table public.profiles
  add constraint profiles_health_conditions_labels check (public.health_conditions_valid(health_conditions));
