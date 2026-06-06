import type { RubyAnnotation } from "../types"

// Split a zhuyin rt like "ㄋㄧˇ" or "˙ㄋㄚ" into letters + tone mark so we
// can render them as two adjacent boxes (letters stacked vertically, tone
// in its own column to the right per Taiwanese typographic convention;
// neutral ˙ is the exception and sits above the column).
const ZHUYIN_TONE_TRAILING = new Set(["ˊ", "ˇ", "ˋ"])
const ZHUYIN_TONE_NEUTRAL = "˙"

export function splitZhuyin(rt: string): {
  readonly letters: string
  readonly tone: string
  readonly neutral: boolean
} {
  if (rt.startsWith(ZHUYIN_TONE_NEUTRAL)) {
    return { letters: rt.slice(ZHUYIN_TONE_NEUTRAL.length), tone: ZHUYIN_TONE_NEUTRAL, neutral: true }
  }
  const last = Array.from(rt).at(-1) ?? ""
  if (ZHUYIN_TONE_TRAILING.has(last)) {
    return { letters: rt.slice(0, rt.length - last.length), tone: last, neutral: false }
  }
  return { letters: rt, tone: "", neutral: false }
}

interface TextBounds {
  readonly fontAscent: number
  readonly actualAscent: number
  readonly fontSize: number
}

// Measures the actual visible glyph bounds in `parentElement`'s computed font
// so the rt can sit just above the kanji's real ink, not the font's full
// em-box (which leaves an awkward gap on tall fonts).
export function getActualTextBounds(element: HTMLElement): TextBounds {
  const style = window.getComputedStyle(element)
  const fontSize = parseFloat(style.fontSize)

  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")
  if (!ctx) {
    return { fontAscent: fontSize * 0.8, actualAscent: fontSize * 0.7, fontSize }
  }

  ctx.font = `${style.fontStyle} ${style.fontWeight} ${fontSize}px ${style.fontFamily}`
  const metrics = ctx.measureText("字")

  return {
    fontAscent: metrics.fontBoundingBoxAscent ?? fontSize * 0.8,
    actualAscent: metrics.actualBoundingBoxAscent,
    fontSize,
  }
}

function applyRubyAdjustment(ruby: HTMLElement, parent: HTMLElement): void {
  const { fontAscent, actualAscent, fontSize } = getActualTextBounds(parent)
  const gap = fontAscent - actualAscent - fontSize * 0.1
  ruby.style.setProperty("--ruby-adjustment", `${Math.max(gap, 0)}px`)
}

export function createRubyFragmentFromAnnotations(
  annotations: readonly RubyAnnotation[],
  parentElement: HTMLElement,
): DocumentFragment {
  const frag = document.createDocumentFragment()

  for (const ann of annotations) {
    if (ann.type === "text") {
      frag.appendChild(document.createTextNode(ann.text))
      continue
    }
    const ruby = document.createElement("ruby")
    applyRubyAdjustment(ruby, parentElement)
    // Mirror the script tag onto the <ruby> as well so CSS can switch
    // `ruby-position` without needing `:has()` parent selectors.
    if (ann.script) ruby.setAttribute("data-yukari-script", ann.script)
    ruby.appendChild(document.createTextNode(ann.base))
    const rt = document.createElement("rt")
    if (ann.script) rt.setAttribute("data-yukari-script", ann.script)
    if (ann.script === "zhuyin") {
      const { letters, tone, neutral } = splitZhuyin(ann.rt)
      if (neutral) rt.setAttribute("data-yukari-zhuyin-tone", "neutral")
      const sylSpan = document.createElement("span")
      sylSpan.className = "yk-zh-syl"
      sylSpan.textContent = letters
      const toneSpan = document.createElement("span")
      toneSpan.className = "yk-zh-tone"
      toneSpan.textContent = tone
      // Tone hangs at the upper right of the rime (last letter), not the
      // top of the whole column — Taiwanese textbook convention. Each
      // upright vertical letter takes ~1em of inline space, so pushing the
      // tone down by (letters-1)em lines it up with the last letter's top.
      // For single-letter syllables we still nudge it up a touch.
      const letterCount = Array.from(letters).length
      if (!neutral && tone) {
        // Base = (letters-1)em to reach the rime's top edge, minus a
        // global nudge so it sits above the letter rather than on it.
        toneSpan.style.setProperty(
          "--yk-zh-tone-offset",
          `calc(${Math.max(0, letterCount - 1)}em - 0.35em)`,
        )
      }
      rt.appendChild(sylSpan)
      rt.appendChild(toneSpan)
    } else {
      rt.textContent = ann.rt
    }
    ruby.appendChild(rt)
    frag.appendChild(ruby)
  }

  return frag
}
