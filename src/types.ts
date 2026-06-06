export interface Morpheme {
  readonly surface: string
  readonly dictionaryForm: string
  readonly readingForm: string
  readonly normalizedForm: string
  readonly partOfSpeech: readonly string[]
  readonly isOov: boolean
  readonly begin: number
  readonly end: number
  // When true, `readingForm` is displayed over the whole surface as-is,
  // skipping kana-alignment. Used for user-dictionary entries so gikun
  // (e.g. 超電磁砲 → レールガン) and non-kana readings render verbatim.
  readonly verbatimReading?: boolean
}

export interface TokenizeResponse {
  readonly morphemes?: readonly Morpheme[]
  readonly error?: string
}

export interface SettingsResponse {
  readonly mutationObserver?: boolean
}

export interface Shortcut {
  readonly ctrl: boolean
  readonly alt: boolean
  readonly shift: boolean
  readonly meta: boolean
  readonly key: string
}

export interface UserDictEntry {
  readonly surface: string
  readonly reading: string
  // Defaults to 'ja' when absent. v1 only applies user-dict entries
  // on the Japanese path; the field exists so future versions can
  // extend per-language without a storage migration.
  readonly lang?: LangCode
}

export type LangCode = "ja" | "zh-Hans" | "zh-Hant"

export type ZhStyle = "pinyin-marks" | "pinyin-num" | "pinyin-none" | "bopomofo"

// Output of every language adapter. Both Japanese morpheme-based ruby
// and Chinese per-character pinyin/bopomofo collapse onto this shape,
// which the DOM layer turns into <ruby>/<rt> spans.
export type RubyAnnotation =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "ruby"
      readonly base: string
      readonly rt: string
      readonly script?: "kana" | "pinyin" | "zhuyin"
    }

// Auto-enable patterns may be plain glob strings (legacy form) or
// objects that pin a specific reading language for matched URLs.
export type AutoEnableEntry = string | { readonly pattern: string; readonly forcedLang?: LangCode }

export interface LanguageToggles {
  readonly ja: boolean
  readonly zhHans: boolean
  readonly zhHant: boolean
}

export const DEFAULT_LANGUAGES: LanguageToggles = {
  ja: true,
  zhHans: false,
  zhHant: false,
}

export const DEFAULT_ZH_STYLE: ZhStyle = "pinyin-marks"

// Zhuyin (bopomofo) is conventionally written to the right of each character
// in vertical orientation (Taiwanese textbook standard); "top" is an opt-in
// fallback for users who prefer the same layout as pinyin/kana ruby.
export type ZhuyinPosition = "right" | "top"

export const DEFAULT_ZHUYIN_POSITION: ZhuyinPosition = "right"

export const DEFAULT_SHORTCUT: Shortcut = {
  ctrl: false,
  alt: true,
  shift: false,
  meta: false,
  key: "f",
}
