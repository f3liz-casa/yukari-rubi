import type {
  AutoEnableEntry,
  LanguageToggles,
  Morpheme,
  RubyAnnotation,
  Shortcut,
  UserDictEntry,
  ZhStyle,
  ZhuyinPosition,
} from "./types"

export interface Settings {
  mutationObserver?: boolean
  rubySize?: number
  autoEnablePatterns?: readonly AutoEnableEntry[]
  shortcut?: Shortcut | null
  userDictionary?: readonly UserDictEntry[]
  languages?: LanguageToggles
  zhStyle?: ZhStyle
  zhuyinPosition?: ZhuyinPosition
}

// RPC interface for background script methods
export interface BackgroundRPC {
  tokenize(
    text: string,
    mode?: string,
  ): Promise<{
    morphemes?: readonly Morpheme[]
    error?: string
  }>
  // Chinese annotation. Returns one RubyAnnotation per han character
  // (plus passthrough text for non-han runs). The background owns the
  // tokenizer/dict lifetime so the cache is shared across tabs.
  annotateZh(
    text: string,
    opts: { style: ZhStyle },
  ): Promise<{
    annotations?: readonly RubyAnnotation[]
    error?: string
  }>
  getSettings(): Promise<Settings>
  setSettings(settings: Settings): Promise<{ ok: boolean }>
  preload(): Promise<{ ready: boolean; error?: string }>
}

// RPC interface for content script methods (if needed in future)
export interface ContentRPC {
  // Add methods here if background needs to call content
}
