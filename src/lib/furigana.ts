import type { Morpheme, RubyAnnotation } from "../types"

const KANJI_PATTERN = /[\u3400-\u9FFF\uF900-\uFAFF\u3005\u303B]/
const KANA_PATTERN = /[\u3040-\u309F\u30A0-\u30FF\u31F0-\u31FF\uFF66-\uFF9F]/

export function isKanji(ch: string): boolean {
  const c = ch.codePointAt(0)
  if (c === undefined) return false
  return (
    (c >= 0x3400 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff) || c === 0x3005 || c === 0x303b
  )
}

export function containsKanji(text: string): boolean {
  return KANJI_PATTERN.test(text)
}

export function containsKana(text: string): boolean {
  return KANA_PATTERN.test(text)
}

// Han characters or kana — anything we might want to annotate. Replaces
// the old containsKanji gate so Chinese-only text (han, no kana) is not
// dropped at the node-collection stage.
export function containsCJK(text: string): boolean {
  return KANJI_PATTERN.test(text) || KANA_PATTERN.test(text)
}

export function katakanaToHiragana(str: string): string {
  return str.replace(/[\u30A1-\u30F6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
}

export interface KanjiSegment {
  readonly type: "kanji"
  readonly text: string
  readonly reading: string
}

interface KanaSegment {
  readonly type: "kana"
  readonly text: string
}

export type FuriganaSegment = KanjiSegment | KanaSegment

function splitSurface(surface: string): ReadonlyArray<{ type: "kanji" | "kana"; text: string }> {
  const segs: Array<{ type: "kanji" | "kana"; text: string }> = []
  let cur = ""
  let curType: "kanji" | "kana" | null = null
  for (const ch of surface) {
    const t = isKanji(ch) ? "kanji" : "kana"
    if (t !== curType) {
      if (cur && curType) segs.push({ type: curType, text: cur })
      cur = ch
      curType = t
    } else {
      cur += ch
    }
  }
  if (cur && curType) segs.push({ type: curType, text: cur })
  return segs
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Align a katakana reading to the kanji/kana structure of a surface form.
 *
 * Returns an array of segments with readings for kanji runs, or null
 * if the surface contains no kanji (no furigana needed).
 *
 * Example: alignFurigana("食べ物", "タベモノ")
 *   → [{ type: "kanji", text: "食", reading: "た" },
 *      { type: "kana",  text: "べ" },
 *      { type: "kanji", text: "物", reading: "もの" }]
 */
export function alignFurigana(
  surface: string,
  readingKatakana: string,
): readonly FuriganaSegment[] | null {
  const reading = katakanaToHiragana(readingKatakana)

  if (!containsKanji(surface)) return null
  if (reading === surface) return null

  const segs = splitSurface(surface)

  if (!segs.some((s) => s.type === "kanji")) return null

  // No kana anchors → whole surface maps to whole reading
  if (!segs.some((s) => s.type === "kana")) {
    return [{ type: "kanji", text: surface, reading }]
  }

  // Build regex: kanji runs become capture groups, kana runs become literal anchors.
  // Last kanji group with no trailing kana is greedy (.+), others are non-greedy (.+?).
  let pattern = "^"
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!
    if (seg.type === "kanji") {
      const noKanaAfter = segs.slice(i + 1).every((s) => s.type !== "kana")
      pattern += noKanaAfter ? "(.+)" : "(.+?)"
    } else {
      pattern += escapeRegex(seg.text)
    }
  }
  pattern += "$"

  const match = reading.match(new RegExp(pattern))
  if (!match) {
    // Fallback: whole-word furigana
    return [{ type: "kanji", text: surface, reading }]
  }

  let cap = 1
  return segs.map(
    (seg): FuriganaSegment =>
      seg.type === "kanji"
        ? { type: "kanji", text: seg.text, reading: match[cap++]! }
        : { type: "kana", text: seg.text },
  )
}

// Collapses Sudachi morphemes (with their post-alignment kanji segments) into
// the language-agnostic RubyAnnotation array consumed by the DOM layer. This
// is the seam between the Japanese-specific tokenizer and the shared ruby
// fragment builder; the Chinese path produces the same shape from pinyin-wasm.
export function morphemesToAnnotations(morphemes: readonly Morpheme[]): readonly RubyAnnotation[] {
  const out: RubyAnnotation[] = []
  for (const m of morphemes) {
    if (m.verbatimReading && m.readingForm) {
      out.push({
        type: "ruby",
        base: m.surface,
        rt: m.readingForm,
        script: "kana",
      })
      continue
    }
    const segments = alignFurigana(m.surface, m.readingForm)
    if (!segments) {
      out.push({ type: "text", text: m.surface })
      continue
    }
    for (const seg of segments) {
      if (seg.type === "kanji") {
        out.push({
          type: "ruby",
          base: seg.text,
          rt: seg.reading,
          script: "kana",
        })
      } else {
        out.push({ type: "text", text: seg.text })
      }
    }
  }
  return out
}
