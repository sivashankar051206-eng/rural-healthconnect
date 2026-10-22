/**
 * Intent detection for the patient voice assistant.
 *
 * The assistant is NAVIGATION + ACCESSIBILITY + GUIDANCE only. It never diagnoses,
 * never recommends medicines, and every action it takes goes through the same
 * authenticated API (and backend authorization) as the buttons do.
 */
export type Intent =
  | 'EMERGENCY'
  | 'OTHER_PATIENT'
  | 'CANCEL_APPOINTMENT'
  | 'BOOK'
  | 'BOOK_TOMORROW'
  | 'MEDICINES'
  | 'RECORDS'
  | 'APPOINTMENTS'
  | 'TALK_TO_DOCTOR'
  | 'HELP'
  | 'HOME'
  | 'UNKNOWN';

/** Priority order: safety first, then destructive/specific actions, then navigation. */
const ORDER: Exclude<Intent, 'BOOK_TOMORROW' | 'UNKNOWN'>[] = [
  'EMERGENCY',
  'OTHER_PATIENT',
  'CANCEL_APPOINTMENT',
  'BOOK',
  'MEDICINES',
  'RECORDS',
  'APPOINTMENTS',
  'TALK_TO_DOCTOR',
  'HELP',
  'HOME',
];

export function normalize(text: string): string {
  return ` ${text
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N}'\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;
}

/**
 * A phrase matches when it starts at a word boundary. Suffixes are allowed
 * (agglutinative languages: "மருந்துகள்" matches "மருந்து").
 */
export function containsPhrase(normalized: string, phrase: string): boolean {
  const p = normalize(phrase).trim();
  return p.length > 0 && normalized.includes(` ${p}`);
}

/** Exact whole-word/phrase match (used for yes/no so "now" is not read as "no"). */
export function containsExact(normalized: string, phrase: string): boolean {
  const p = normalize(phrase).trim();
  return p.length > 0 && normalized.includes(` ${p} `);
}

export function detectIntent(alternatives: string[], phrases: Record<string, string[]>): Intent {
  for (const alt of alternatives) {
    const n = normalize(alt);
    for (const intent of ORDER) {
      if ((phrases[intent] ?? []).some((p) => containsPhrase(n, p))) {
        if (intent === 'BOOK' && (phrases.TOMORROW ?? []).some((p) => containsExact(n, p) || containsPhrase(n, p))) {
          return 'BOOK_TOMORROW';
        }
        return intent;
      }
    }
  }
  return 'UNKNOWN';
}

export function detectYesNo(alternatives: string[], phrases: Record<string, string[]>): 'YES' | 'NO' | null {
  for (const alt of alternatives) {
    const n = normalize(alt);
    // Check NO first so that "no, don't" is never treated as yes.
    if ((phrases.NO ?? []).some((p) => containsExact(n, p))) return 'NO';
    if ((phrases.YES ?? []).some((p) => containsExact(n, p))) return 'YES';
  }
  return null;
}
