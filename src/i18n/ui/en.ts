// Interface words shared by forms, dialogs and editors on every page (dashboard, account, admin).
// Kept small and separate from the page dictionaries because client components bundle it.
// Every other language must provide exactly the same keys (enforced by the `UiText` type).
const en = {
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved',
  cancel: 'Cancel',
  confirm: 'Confirm',
  working: 'Working…',
  optional: 'optional',
  fieldsNeedAttention: 'Some fields need attention. Please check the highlighted fields.',
  checkForm: 'Please check the form.',
  checkValue: 'Please check this value.',
  friendly: {
    invalid_phone: 'Enter a valid phone number, e.g. +351 935 413 677.',
    invalid_url: 'Enter a full link starting with https://',
    https_required: 'The link must start with https://',
    wrong_domain: 'This link does not belong to the expected website.',
    invalid_postal_pt: 'Use the Portuguese format 0000-000.',
    invalid_postal_es: 'Use the Spanish format 00000.',
    default_must_be_enabled: 'The default language must be one of the enabled languages.',
    source_must_be_enabled: 'The source language must be one of the enabled languages.',
  },
  hours: {
    mon: 'Monday',
    tue: 'Tuesday',
    wed: 'Wednesday',
    thu: 'Thursday',
    fri: 'Friday',
    sat: 'Saturday',
    sun: 'Sunday',
    notSet: 'Opening hours are not set yet. Add the hours your restaurant is open.',
    inherits: 'Using your opening hours. Add hours here only if they are different.',
    asOpening: 'As opening hours',
    closed: 'Closed',
    opens: '{day} opens',
    closes: '{day} closes',
    remove: 'Remove {day} hours {range}',
    addShort: '+ Add',
    add: '+ Add hours',
    copyAll: 'Use {day}’s hours for every day',
    useOpening: 'Use opening hours again',
  },
};
export default en;
type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
export type UiText = Widen<typeof en>;
