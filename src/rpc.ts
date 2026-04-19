import type { Morpheme, Shortcut, UserDictEntry } from "./types"

export interface Settings {
  mutationObserver?: boolean
  rubySize?: number
  autoEnablePatterns?: string[]
  shortcut?: Shortcut | null
  userDictionary?: readonly UserDictEntry[]
}

// RPC interface for background script methods
export interface BackgroundRPC {
  tokenize(text: string, mode?: string): Promise<{
    morphemes?: readonly Morpheme[]
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
