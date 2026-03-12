export interface Morpheme {
  readonly surface: string;
  readonly dictionaryForm: string;
  readonly readingForm: string;
  readonly normalizedForm: string;
  readonly partOfSpeech: readonly string[];
  readonly isOov: boolean;
  readonly begin: number;
  readonly end: number;
}

export interface TokenizeResponse {
  readonly morphemes?: readonly Morpheme[];
  readonly error?: string;
}

export interface SettingsResponse {
  readonly mutationObserver?: boolean;
}
