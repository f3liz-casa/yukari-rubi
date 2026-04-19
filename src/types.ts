export interface Morpheme {
  readonly surface: string;
  readonly dictionaryForm: string;
  readonly readingForm: string;
  readonly normalizedForm: string;
  readonly partOfSpeech: readonly string[];
  readonly isOov: boolean;
  readonly begin: number;
  readonly end: number;
  // When true, `readingForm` is displayed over the whole surface as-is,
  // skipping kana-alignment. Used for user-dictionary entries so gikun
  // (e.g. 超電磁砲 → レールガン) and non-kana readings render verbatim.
  readonly verbatimReading?: boolean;
}

export interface TokenizeResponse {
  readonly morphemes?: readonly Morpheme[];
  readonly error?: string;
}

export interface SettingsResponse {
  readonly mutationObserver?: boolean;
}

export interface Shortcut {
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
  readonly key: string;
}

export interface UserDictEntry {
  readonly surface: string;
  readonly reading: string;
}

export const DEFAULT_SHORTCUT: Shortcut = {
  ctrl: false,
  alt: true,
  shift: false,
  meta: false,
  key: "f",
};
