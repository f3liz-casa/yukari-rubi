import type { Morpheme } from "./types"

// RPC interface for background script methods
export interface BackgroundRPC {
  tokenize(text: string, mode?: string): Promise<{
    morphemes?: readonly Morpheme[]
    error?: string
  }>
  getSettings(): Promise<{ mutationObserver?: boolean }>
  setSettings(settings: { mutationObserver?: boolean }): Promise<{ ok: boolean }>
  preload(): Promise<{ ready: boolean; error?: string }>
}

// RPC interface for content script methods (if needed in future)
export interface ContentRPC {
  // Add methods here if background needs to call content
}
