import type { AutoEnableEntry, LangCode, LanguageToggles } from "../types"
import { containsKana } from "./furigana"

// Characters that appear effectively only in Traditional Chinese
// (Japanese kanji uses different simplified shinjitai for these, and PRC
// simplified uses different shapes too). Hitting any of these is a strong
// "this is zh-Hant" signal.
const HANT_MARKERS = new Set([
  "們",
  "學",
  "國",
  "體",
  "專",
  "廣",
  "會",
  "對",
  "來",
  "樂",
  "點",
  "兩",
  "這",
  "從",
  "與",
  "觀",
  "變",
  "聲",
  "萬",
  "鐵",
  "醫",
  "號",
  "黨",
  "區",
  "圖",
  "處",
  "藝",
  "務",
  "義",
  "證",
])

// Characters unique to PRC Simplified (not used in Japanese or Traditional).
// Hitting any of these is a strong "this is zh-Hans" signal.
const HANS_MARKERS = new Set([
  "们",
  "这",
  "个",
  "让",
  "时",
  "习",
  "见",
  "长",
  "风",
  "东",
  "边",
  "远",
  "进",
  "还",
  "该",
  "给",
  "写",
  "觉",
  "现",
  "节",
  "样",
  "应",
  "实",
  "义",
  "话",
  "认",
  "识",
  "门",
  "电",
  "车",
])

function countChars(text: string, set: ReadonlySet<string>): number {
  let n = 0
  for (const ch of text) {
    if (set.has(ch)) n++
  }
  return n
}

// Normalize a `lang` attribute value to one of our LangCodes, or null.
function langTagToCode(tag: string): LangCode | null {
  const t = tag.toLowerCase().trim()
  if (!t) return null
  if (t.startsWith("ja")) return "ja"
  if (
    t.startsWith("zh-hant") ||
    t.startsWith("zh-tw") ||
    t.startsWith("zh-hk") ||
    t.startsWith("zh-mo")
  ) {
    return "zh-Hant"
  }
  if (t.startsWith("zh-hans") || t.startsWith("zh-cn") || t.startsWith("zh-sg") || t === "zh") {
    return "zh-Hans"
  }
  if (t.startsWith("zh")) return "zh-Hans"
  return null
}

function nearestLangFromAncestors(node: Node): LangCode | null {
  let el: Element | null =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  while (el) {
    const tag = el.getAttribute("lang") || el.getAttribute("xml:lang")
    if (tag) {
      const code = langTagToCode(tag)
      if (code) return code
    }
    el = el.parentElement
  }
  return null
}

function pageDefaultLang(doc: Document): LangCode | null {
  const root = doc.documentElement.getAttribute("lang")
  return root ? langTagToCode(root) : null
}

// Confidence tiers let the caller decide whether a script signal is strong
// enough to override a conflicting ancestor `lang` attribute.
//   strong  — unambiguous (kana, or a clear marker-count winner)
//   weak    — markers seen on both sides, picked by majority but not decisive
//   none    — no signal in the text itself
type ScriptPick =
  | { readonly lang: LangCode; readonly confidence: "strong" | "weak" }
  | null

function pickByScript(text: string): ScriptPick {
  // Kana never appears in Chinese — strongest possible signal.
  if (containsKana(text)) return { lang: "ja", confidence: "strong" }

  const hant = countChars(text, HANT_MARKERS)
  const hans = countChars(text, HANS_MARKERS)
  if (hant === 0 && hans === 0) return null

  // Only one side fired → strong. Both fired → majority wins but weak,
  // since a single stray quote/loanword shouldn't flip a long passage.
  if (hans === 0) return { lang: "zh-Hant", confidence: "strong" }
  if (hant === 0) return { lang: "zh-Hans", confidence: "strong" }
  if (hans > hant) return { lang: "zh-Hans", confidence: "weak" }
  if (hant > hans) return { lang: "zh-Hant", confidence: "weak" }
  return null
}

function matchForcedLang(
  url: string,
  patterns: readonly AutoEnableEntry[] | undefined,
): LangCode | null {
  if (!patterns) return null
  for (const entry of patterns) {
    if (typeof entry === "string") continue
    if (!entry.forcedLang) continue
    const re = globToRegExp(entry.pattern)
    if (re.test(url)) return entry.forcedLang
  }
  return null
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  const withWildcards = escaped
    .replace(/\*\*/g, "\x00")
    .replace(/\*/g, "[^/]*")
    .replace(/\x00/g, ".*")
  return new RegExp(`^${withWildcards}$`)
}

function isLangEnabled(lang: LangCode, toggles: LanguageToggles): boolean {
  if (lang === "ja") return toggles.ja
  if (lang === "zh-Hans") return toggles.zhHans
  if (lang === "zh-Hant") return toggles.zhHant
  return false
}

// Sentence terminators shared across Japanese and Chinese:
//   。 ideographic full stop (both)
//   ． fullwidth period (CJK)
//   ！？ fullwidth exclamation / question (both)
//   !? ASCII equivalents (mixed-script writing)
//   … horizontal ellipsis (often ends a sentence in CJ fiction)
//   ； fullwidth semicolon (used as a sentence break in Chinese)
// ASCII `.` is ambiguous (decimal points, file extensions, version numbers)
// so it only counts as a terminator when followed by whitespace or end of
// string — same heuristic plain-text sentence splitters use.
// Closing quotes/brackets after the terminator are absorbed into the same
// segment so 「…！」 stays together.
const SENTENCE_RE =
  /[^。．！？!?…；]*?(?:[。．！？!?…；]+|\.(?=\s|$))[」』）)\]】〕》〉］｝"'"']*\s*/gu

// Break `text` into sentence-sized chunks at CJK terminators. The trailing
// fragment (text with no terminator at the end) is kept as its own segment
// so we never silently drop characters.
export function splitIntoSentences(text: string): readonly string[] {
  const out: string[] = []
  let consumed = 0
  for (const m of text.matchAll(SENTENCE_RE)) {
    out.push(m[0])
    consumed += m[0].length
  }
  if (consumed < text.length) out.push(text.slice(consumed))
  return out.length > 0 ? out : [text]
}

export interface LangSegment {
  readonly lang: LangCode | null
  readonly text: string
}

// Split `text` into sentences, detect a language per sentence, and merge
// adjacent same-lang runs back together so the annotator only has to make
// one call per language switch.
export function detectLangSegments(input: DetectInputs): readonly LangSegment[] {
  const sentences = splitIntoSentences(input.text)
  const out: LangSegment[] = []
  for (const s of sentences) {
    const lang = detectLangForNode({ ...input, text: s })
    const last = out[out.length - 1]
    if (last && last.lang === lang) {
      out[out.length - 1] = { lang, text: last.text + s }
    } else {
      out.push({ lang, text: s })
    }
  }
  return out
}

export interface DetectInputs {
  readonly text: string
  readonly node: Node
  readonly toggles: LanguageToggles
  readonly autoEnablePatterns?: readonly AutoEnableEntry[]
  readonly url?: string
}

// Resolve which language adapter should annotate `text` for `node`. Returns
// null when the resolved lang is disabled in user settings or the text is
// truly indeterminate. Per-node decision so mixed-language pages get correct
// per-segment treatment.
export function detectLangForNode(input: DetectInputs): LangCode | null {
  const { text, node, toggles, autoEnablePatterns, url } = input

  // 1. Per-site forced lang takes precedence — user explicitly pinned.
  if (url) {
    const forced = matchForcedLang(url, autoEnablePatterns)
    if (forced && isLangEnabled(forced, toggles)) return forced
  }

  // 2. Strong script signal from the text itself wins over ancestor tags.
  //    Catches kana inside a zh-tagged container, or a Chinese quote inside
  //    a ja-tagged article — ancestor `lang` is often wrong at this scale.
  const scripted = pickByScript(text)
  if (scripted?.confidence === "strong" && isLangEnabled(scripted.lang, toggles)) {
    return scripted.lang
  }

  // 3. Nearest ancestor lang attribute — trusted for ambiguous pure-han text.
  const ancestorLang = nearestLangFromAncestors(node)
  if (ancestorLang && isLangEnabled(ancestorLang, toggles)) return ancestorLang

  // 4. Weak script signal (mixed markers, picked by majority).
  if (scripted && isLangEnabled(scripted.lang, toggles)) return scripted.lang

  // 5. Page <html lang> as fallback for genuinely-ambiguous pure-han.
  const ownerDoc = node.ownerDocument ?? document
  const pageLang = pageDefaultLang(ownerDoc)
  if (pageLang && isLangEnabled(pageLang, toggles)) return pageLang

  // 6. Last-resort: if only one language is enabled and the text looks CJK
  //    enough to bother, fall through to that. Otherwise skip the node.
  const enabled = (
    [
      ["ja", toggles.ja],
      ["zh-Hans", toggles.zhHans],
      ["zh-Hant", toggles.zhHant],
    ] as const
  ).filter(([, on]) => on)
  if (enabled.length === 1) return enabled[0]![0]

  return null
}
