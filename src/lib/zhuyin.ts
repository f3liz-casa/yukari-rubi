// Deterministic pinyin → zhuyin (注音符号 / Bopomofo) conversion.
// `pinyin-wasm` (the WASM crate we ship) does not produce zhuyin natively;
// this module receives a numbered-pinyin syllable like "ni3" or "shang4"
// and emits the corresponding zhuyin sequence with tone mark.

const INITIALS_2: Record<string, string> = {
  zh: "ㄓ",
  ch: "ㄔ",
  sh: "ㄕ",
}

const INITIALS_1: Record<string, string> = {
  b: "ㄅ",
  p: "ㄆ",
  m: "ㄇ",
  f: "ㄈ",
  d: "ㄉ",
  t: "ㄊ",
  n: "ㄋ",
  l: "ㄌ",
  g: "ㄍ",
  k: "ㄎ",
  h: "ㄏ",
  j: "ㄐ",
  q: "ㄑ",
  x: "ㄒ",
  r: "ㄖ",
  z: "ㄗ",
  c: "ㄘ",
  s: "ㄙ",
}

const FINALS: Record<string, string> = {
  a: "ㄚ",
  o: "ㄛ",
  e: "ㄜ",
  ai: "ㄞ",
  ei: "ㄟ",
  ao: "ㄠ",
  ou: "ㄡ",
  an: "ㄢ",
  en: "ㄣ",
  ang: "ㄤ",
  eng: "ㄥ",
  er: "ㄦ",
  i: "ㄧ",
  ia: "ㄧㄚ",
  ie: "ㄧㄝ",
  iao: "ㄧㄠ",
  iu: "ㄧㄡ",
  iou: "ㄧㄡ",
  ian: "ㄧㄢ",
  in: "ㄧㄣ",
  iang: "ㄧㄤ",
  ing: "ㄧㄥ",
  u: "ㄨ",
  ua: "ㄨㄚ",
  uo: "ㄨㄛ",
  uai: "ㄨㄞ",
  ui: "ㄨㄟ",
  uei: "ㄨㄟ",
  uan: "ㄨㄢ",
  un: "ㄨㄣ",
  uen: "ㄨㄣ",
  uang: "ㄨㄤ",
  ueng: "ㄨㄥ",
  ong: "ㄨㄥ",
  ü: "ㄩ",
  v: "ㄩ",
  üe: "ㄩㄝ",
  ve: "ㄩㄝ",
  üan: "ㄩㄢ",
  van: "ㄩㄢ",
  ün: "ㄩㄣ",
  vn: "ㄩㄣ",
  iong: "ㄩㄥ",
}

// Whole-syllable forms whose pinyin spelling masks the underlying initial+final.
// e.g. "yi" → ㄧ (not "y" + "i"), "wu" → ㄨ, "yu" → ㄩ, "ye" → ㄧㄝ.
const WHOLE: Record<string, string> = {
  yi: "ㄧ",
  yin: "ㄧㄣ",
  ying: "ㄧㄥ",
  ya: "ㄧㄚ",
  yao: "ㄧㄠ",
  yan: "ㄧㄢ",
  yang: "ㄧㄤ",
  ye: "ㄧㄝ",
  you: "ㄧㄡ",
  yong: "ㄩㄥ",
  yu: "ㄩ",
  yue: "ㄩㄝ",
  yuan: "ㄩㄢ",
  yun: "ㄩㄣ",
  wu: "ㄨ",
  wa: "ㄨㄚ",
  wo: "ㄨㄛ",
  wai: "ㄨㄞ",
  wei: "ㄨㄟ",
  wan: "ㄨㄢ",
  wen: "ㄨㄣ",
  wang: "ㄨㄤ",
  weng: "ㄨㄥ",
}

// Pinyin tone digits → zhuyin tone marks. Tone 1 has no glyph (high level
// is the unmarked default); tones 2/3/4 trail the syllable; tone 5 (neutral)
// is a leading dot, distinct from the others.
const TONE_TRAILING: Record<string, string> = {
  "1": "",
  "2": "ˊ",
  "3": "ˇ",
  "4": "ˋ",
}
const TONE_NEUTRAL = "˙"

// Initials zhi/chi/shi/ri/zi/ci/si use a placeholder "i" with no zhuyin
// final glyph — the reading is just the initial symbol.
const INITIAL_ONLY = new Set(["zh", "ch", "sh", "r", "z", "c", "s"])

export function pinyinSyllableToZhuyin(syllable: string): string {
  // Accept "ni3", "shang4", "lu:e2" (libpinyin-style ü), "lve2" (v=ü).
  const m = syllable.match(/^([a-zü:]+)(\d?)$/i)
  if (!m) return syllable
  const baseRaw = m[1]!.toLowerCase()
  // Some pinyin sources represent ü as "u:" or "v" — normalize.
  const base = baseRaw.replace(/u:/g, "ü")
  const toneDigit = m[2] || "1"
  const isNeutral = toneDigit === "5" || toneDigit === "0"
  const trailingTone = isNeutral ? "" : (TONE_TRAILING[toneDigit] ?? "")

  const compose = (body: string): string => (isNeutral ? TONE_NEUTRAL + body : body + trailingTone)

  // Whole-syllable shortcut (yi/wu/yu families).
  const whole = WHOLE[base]
  if (whole !== undefined) return compose(whole)

  // Two-char initial first (zh/ch/sh).
  let initial = ""
  let rest = base
  const prefix2 = base.slice(0, 2)
  if (INITIALS_2[prefix2] !== undefined) {
    initial = INITIALS_2[prefix2]!
    rest = base.slice(2)
  } else if (INITIALS_1[base[0]!] !== undefined) {
    initial = INITIALS_1[base[0]!]!
    rest = base.slice(1)
  }

  // Pinyin orthography drops the umlaut after j/q/x because those initials
  // can only be followed by ü, never u. Restore it so the lookup hits the
  // ü-prefixed finals (üe, üan, ün, …).
  if ((base[0] === "j" || base[0] === "q" || base[0] === "x") && rest.startsWith("u")) {
    rest = "ü" + rest.slice(1)
  }

  // zhi/chi/shi/ri/zi/ci/si — the placeholder "i" has no zhuyin glyph.
  const head = base.slice(0, base.length - 1)
  if (rest === "i" && INITIAL_ONLY.has(head)) {
    return compose(initial)
  }

  const final = FINALS[rest]
  if (initial && final !== undefined) return compose(initial + final)
  if (!initial && final !== undefined) return compose(final)
  // Unrecognised — fall back to original pinyin so the user at least sees something.
  return syllable
}
