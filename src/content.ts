import { createBirpc } from "birpc"
import Browser from "webextension-polyfill"

import { containsCJK, morphemesToAnnotations } from "./lib/furigana"
import { detectLangSegments } from "./lib/lang-detect"
import { createRubyFragmentFromAnnotations, splitZhuyin } from "./lib/ruby"
import type { BackgroundRPC } from "./rpc"
import type {
  AutoEnableEntry,
  LangCode,
  LanguageToggles,
  Morpheme,
  RubyAnnotation,
  Shortcut,
  ZhStyle,
} from "./types"
import { DEFAULT_LANGUAGES, DEFAULT_ZH_STYLE } from "./types"

const PROCESSED_ATTR = "data-yukari"
const CONTAINER_CLASS = "yukari-rubi"

// Scrapbox renders text as per-character spans inside its editor; the default
// path would tokenize each char in isolation and mutate editor text nodes,
// which gives wrong readings and can break cursor mapping. Handle it specially
// by reconstructing the full text from char-index spans, tokenizing once, and
// wrapping the spans of each kanji morpheme in a real <ruby> element so the
// browser handles positioning and widening.
const IS_SCRAPBOX =
  location.hostname === "scrapbox.io" || location.hostname.endsWith(".scrapbox.io")
// Stores the last-processed full text of a span.text so edits re-run tokenization.
const SCRAPBOX_PROCESSED_ATTR = "data-yukari-scrapbox"
const SCRAPBOX_RUBY_CLASS = "yukari-scrapbox-ruby"

const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "TEXTAREA",
  "INPUT",
  "SELECT",
  "RUBY",
  "RT",
  "RP",
  "CODE",
  "PRE",
  "KBD",
  "SAMP",
  "NOSCRIPT",
  "TEMPLATE",
  "SVG",
  "MATH",
  "CANVAS",
  "VIDEO",
  "AUDIO",
  "IFRAME",
  "OBJECT",
  "EMBED",
])

let active = false
let observer: MutationObserver | null = null
let processing = false

// --- Glob pattern matching for URLs ---

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  const withWildcards = escaped
    .replace(/\*\*/g, "\x00")
    .replace(/\*/g, "[^/]*")
    .replace(/\x00/g, ".*")
  return new RegExp(`^${withWildcards}$`)
}

function patternsOf(entries: readonly AutoEnableEntry[]): string[] {
  return entries.map((e) => (typeof e === "string" ? e : e.pattern))
}

function urlMatchesPatterns(url: string, patterns: string[]): boolean {
  return patterns.some((p) => globToRegExp(p).test(url))
}

// --- Language settings cache (refreshed on activate + storage.onChanged) ---

let langSettings: {
  toggles: LanguageToggles
  zhStyle: ZhStyle
  autoEnablePatterns: readonly AutoEnableEntry[]
} = {
  toggles: DEFAULT_LANGUAGES,
  zhStyle: DEFAULT_ZH_STYLE,
  autoEnablePatterns: [],
}

// --- Set up birpc client ---

// For browser extensions, responses come back via sendMessage promise,
// but birpc expects them via the on() callback. We need to bridge this.
let onMessageCallback: ((data: any) => void) | null = null

const bg = createBirpc<BackgroundRPC>(
  {},
  {
    post: async (data) => {
      console.log("[yukari-rubi] Content sending birpc message:", data)
      const response = await Browser.runtime.sendMessage(data)
      console.log("[yukari-rubi] Content received birpc response:", response)
      // Feed the response back into birpc via the on() callback
      if (response && onMessageCallback) {
        onMessageCallback(response)
      }
      return response
    },
    on: (fn) => {
      onMessageCallback = fn
      Browser.runtime.onMessage.addListener((message) => {
        // Check if this is a birpc message by looking for the type field
        if (message && typeof message === "object" && message.t) {
          console.log("[yukari-rubi] Content received birpc message:", message)
          fn(message)
        }
      })
    },
    serialize: (v) => v,
    deserialize: (v) => v,
  },
)

// --- Annotation via background (per-language dispatch) ---

async function tokenize(text: string): Promise<readonly Morpheme[]> {
  const response = await bg.tokenize(text, "A")
  if (response.error) throw new Error(response.error)
  return response.morphemes ?? []
}

async function annotateForLang(text: string, lang: LangCode): Promise<readonly RubyAnnotation[]> {
  if (lang === "ja") {
    const morphemes = await tokenize(text)
    return morphemesToAnnotations(morphemes)
  }
  const response = await bg.annotateZh(text, { style: langSettings.zhStyle })
  if (response.error) throw new Error(response.error)
  return response.annotations ?? []
}

// --- DOM utilities ---

function shouldSkipElement(el: Element): boolean {
  return SKIP_TAGS.has(el.tagName) || el.classList.contains(CONTAINER_CLASS)
}

function collectTextNodes(root: Node): Text[] {
  const nodes: Text[] = []
  let skippedRuby = 0
  let skippedProcessed = 0
  let skippedNoCJK = 0
  let skippedOther = 0

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node): number {
      const parent = node.parentElement
      if (!parent) {
        skippedOther++
        return NodeFilter.FILTER_SKIP
      }
      if (parent.closest(`.${CONTAINER_CLASS}`)) {
        return NodeFilter.FILTER_REJECT
      }
      if (parent.hasAttribute(PROCESSED_ATTR)) {
        skippedProcessed++
        return NodeFilter.FILTER_REJECT
      }
      if (shouldSkipElement(parent)) {
        if (parent.tagName === "RUBY" || parent.closest("ruby")) {
          skippedRuby++
        } else {
          skippedOther++
        }
        return NodeFilter.FILTER_REJECT
      }
      if (!node.textContent || !containsCJK(node.textContent)) {
        skippedNoCJK++
        return NodeFilter.FILTER_SKIP
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })

  let current = walker.nextNode()
  // oxlint-disable-next-line fp/no-loop-statements
  while (current) {
    nodes.push(current as Text)
    current = walker.nextNode()
  }
  console.log(`[yukari-rubi] Found ${nodes.length} text nodes to process`)
  console.log(
    `[yukari-rubi] Skipped: ${skippedRuby} in ruby tags, ${skippedProcessed} already processed, ${skippedNoCJK} without CJK, ${skippedOther} other`,
  )
  return nodes
}

// --- Process a single text node ---

async function processTextNode(textNode: Text): Promise<void> {
  const text = textNode.textContent
  if (!text || !containsCJK(text)) return
  if (!textNode.parentNode || !textNode.isConnected) return

  // Split into sentence-sized segments so a mixed-language text node
  // (e.g. a Japanese sentence quoting a Chinese line) gets each part
  // annotated by the right adapter.
  const segments = detectLangSegments({
    text,
    node: textNode,
    toggles: langSettings.toggles,
    autoEnablePatterns: langSettings.autoEnablePatterns,
    url: location.href,
  })
  if (segments.every((s) => s.lang === null)) return

  const annotations: RubyAnnotation[] = []
  for (const seg of segments) {
    if (seg.lang === null) {
      annotations.push({ type: "text", text: seg.text })
      continue
    }
    try {
      const segAnn = await annotateForLang(seg.text, seg.lang)
      annotations.push(...segAnn)
    } catch (err) {
      console.warn(`[yukari-rubi] [${seg.lang}] annotation failed:`, err)
      annotations.push({ type: "text", text: seg.text })
    }
  }

  // Re-check state and node after async call
  if (!active || !textNode.parentNode || !textNode.isConnected) return
  if (annotations.length === 0) return

  const container = document.createElement("span")
  container.className = CONTAINER_CLASS
  container.setAttribute(PROCESSED_ATTR, text)

  const parent = textNode.parentElement || document.body
  container.appendChild(createRubyFragmentFromAnnotations(annotations, parent))

  if (textNode.parentNode) {
    const replacing = textNode.parentNode as Element
    console.log(
      `[yukari-rubi] Replacing text node in <${replacing.nodeName}> with ${annotations.length} annotations`,
    )
    textNode.parentNode.replaceChild(container, textNode)
  } else {
    console.warn("[yukari-rubi] Text node lost parent before replacement")
  }
}

// --- Process all text nodes under root ---

async function processRoot(root: Node): Promise<void> {
  if (IS_SCRAPBOX) {
    await processScrapboxRoot(root)
    return
  }
  const textNodes = collectTextNodes(root)
  if (textNodes.length === 0) return

  const BATCH = 10
  for (let i = 0; i < textNodes.length; i += BATCH) {
    if (!active) break
    const batch = textNodes.slice(i, i + BATCH)
    await Promise.all(batch.map(processTextNode))
  }
}

// --- Scrapbox-specific processing ---

function collectScrapboxTextElements(root: Node): HTMLElement[] {
  if (!(root instanceof Element) && !(root instanceof Document)) return []
  const out: HTMLElement[] = []
  const rootEl = root as Element
  if (rootEl instanceof HTMLElement && rootEl.classList.contains("text")) {
    out.push(rootEl)
  }
  const nested = rootEl.querySelectorAll<HTMLElement>("span.text")
  for (const el of nested) out.push(el)
  return out
}

function readScrapboxFullText(textEl: HTMLElement): {
  readonly charSpans: HTMLElement[]
  readonly fullText: string
} {
  // Scrapbox sometimes wraps char-index spans in an intermediate <span>,
  // so use a descendant selector rather than direct children.
  const charSpans = Array.from(textEl.querySelectorAll<HTMLElement>(".char-index"))
  charSpans.sort((a, b) => {
    const ai = Number(a.dataset.charIndex ?? "0")
    const bi = Number(b.dataset.charIndex ?? "0")
    return ai - bi
  })
  const fullText = charSpans.map((s) => s.dataset.char ?? s.textContent ?? "").join("")
  return { charSpans, fullText }
}

function unwrapScrapboxRubies(textEl: HTMLElement): void {
  const rubies = textEl.querySelectorAll<HTMLElement>(`ruby.${SCRAPBOX_RUBY_CLASS}`)
  for (const ruby of rubies) {
    const parent = ruby.parentNode
    if (!parent) continue
    // Move the char-index spans back out in front of the ruby, then drop
    // the ruby (taking the <rt>/<rp> children with it).
    for (const child of Array.from(ruby.childNodes)) {
      if (child instanceof HTMLElement && child.classList.contains("char-index")) {
        parent.insertBefore(child, ruby)
      }
    }
    ruby.remove()
  }
}

async function processScrapboxTextElement(textEl: HTMLElement): Promise<void> {
  const { fullText } = readScrapboxFullText(textEl)
  if (fullText.length === 0) return

  // Skip if the text hasn't changed since our last pass. Edits by scrapbox
  // will update child char-index spans, changing fullText and re-triggering.
  if (textEl.getAttribute(SCRAPBOX_PROCESSED_ATTR) === fullText) return
  textEl.setAttribute(SCRAPBOX_PROCESSED_ATTR, fullText)

  if (!containsCJK(fullText)) return

  const segments = detectLangSegments({
    text: fullText,
    node: textEl,
    toggles: langSettings.toggles,
    autoEnablePatterns: langSettings.autoEnablePatterns,
    url: location.href,
  })
  if (segments.every((s) => s.lang === null)) {
    textEl.removeAttribute(SCRAPBOX_PROCESSED_ATTR)
    return
  }

  // Drop any stale rubies left over from a previous state of this line
  // before re-annotating the current text.
  unwrapScrapboxRubies(textEl)

  const annotations: RubyAnnotation[] = []
  try {
    for (const seg of segments) {
      if (seg.lang === null) {
        annotations.push({ type: "text", text: seg.text })
        continue
      }
      const segAnn = await annotateForLang(seg.text, seg.lang)
      annotations.push(...segAnn)
    }
  } catch (e) {
    textEl.removeAttribute(SCRAPBOX_PROCESSED_ATTR)
    throw e
  }

  if (!active || !textEl.isConnected) return

  // Re-query after the async gap in case scrapbox re-rendered the line.
  const { charSpans, fullText: currentText } = readScrapboxFullText(textEl)
  if (currentText !== fullText) {
    textEl.removeAttribute(SCRAPBOX_PROCESSED_ATTR)
    return
  }

  // Scrapbox creates one char-index span per JS string unit, so .length
  // (UTF-16 units) lines up with char-index values directly. Walk the
  // annotation list with a running position counter — ruby annotations
  // wrap their span range, text annotations just advance the cursor.
  let pos = 0
  for (const ann of annotations) {
    if (ann.type === "ruby") {
      wrapScrapboxRuby(charSpans, pos, ann.base.length, ann.rt, ann.script)
      pos += ann.base.length
    } else {
      pos += ann.text.length
    }
  }
}

function wrapScrapboxRuby(
  charSpans: readonly HTMLElement[],
  startIdx: number,
  length: number,
  reading: string,
  script: "kana" | "pinyin" | "zhuyin" | undefined,
): void {
  const first = charSpans[startIdx]
  if (!first) return
  const parent = first.parentNode
  if (!parent) return
  // All spans in this morpheme must share a parent to be wrapped together.
  for (let i = 1; i < length; i++) {
    const span = charSpans[startIdx + i]
    if (!span || span.parentNode !== parent) return
  }
  // If the first span is already inside one of our rubies (e.g. from a
  // partial reprocess), skip to avoid double-wrapping.
  if (first.parentElement?.closest(`ruby.${SCRAPBOX_RUBY_CLASS}`)) return

  const ruby = document.createElement("ruby")
  ruby.className = SCRAPBOX_RUBY_CLASS
  if (script) ruby.setAttribute("data-yukari-script", script)
  parent.insertBefore(ruby, first)
  for (let i = 0; i < length; i++) {
    const span = charSpans[startIdx + i]
    if (span) ruby.appendChild(span)
  }
  const rpOpen = document.createElement("rp")
  rpOpen.textContent = "("
  const rt = document.createElement("rt")
  if (script) rt.setAttribute("data-yukari-script", script)
  if (script === "zhuyin") {
    const { letters, tone, neutral } = splitZhuyin(reading)
    if (neutral) rt.setAttribute("data-yukari-zhuyin-tone", "neutral")
    const sylSpan = document.createElement("span")
    sylSpan.className = "yk-zh-syl"
    sylSpan.textContent = letters
    const toneSpan = document.createElement("span")
    toneSpan.className = "yk-zh-tone"
    toneSpan.textContent = tone
    const letterCount = Array.from(letters).length
    if (!neutral && tone) {
      toneSpan.style.setProperty(
        "--yk-zh-tone-offset",
        `calc(${Math.max(0, letterCount - 1)}em - 0.35em)`,
      )
    }
    rt.appendChild(sylSpan)
    rt.appendChild(toneSpan)
  } else {
    rt.textContent = reading
  }
  const rpClose = document.createElement("rp")
  rpClose.textContent = ")"
  ruby.appendChild(rpOpen)
  ruby.appendChild(rt)
  ruby.appendChild(rpClose)
}

async function processScrapboxRoot(root: Node): Promise<void> {
  const elements = collectScrapboxTextElements(root)
  if (elements.length === 0) return
  const BATCH = 10
  for (let i = 0; i < elements.length; i += BATCH) {
    if (!active) break
    const batch = elements.slice(i, i + BATCH)
    await Promise.all(
      batch.map((el) =>
        processScrapboxTextElement(el).catch((e) => {
          if (e instanceof Error && e.message.includes("DeadObject")) return
          console.error("[yukari-rubi] scrapbox processing error:", e)
        }),
      ),
    )
  }
}

function removeScrapboxAnnotations(): void {
  for (const ruby of document.querySelectorAll<HTMLElement>(`ruby.${SCRAPBOX_RUBY_CLASS}`)) {
    const parent = ruby.parentNode
    if (!parent) continue
    for (const child of Array.from(ruby.childNodes)) {
      if (child instanceof HTMLElement && child.classList.contains("char-index")) {
        parent.insertBefore(child, ruby)
      }
    }
    ruby.remove()
  }
  for (const el of document.querySelectorAll(`[${SCRAPBOX_PROCESSED_ATTR}]`)) {
    el.removeAttribute(SCRAPBOX_PROCESSED_ATTR)
  }
}

// --- Remove all annotations ---

function removeAnnotations(): void {
  if (IS_SCRAPBOX) {
    removeScrapboxAnnotations()
    return
  }
  const containers = document.querySelectorAll(`.${CONTAINER_CLASS}`)
  for (const el of containers) {
    const original = el.getAttribute(PROCESSED_ATTR)
    if (original !== null) {
      const textNode = document.createTextNode(original)
      el.parentNode?.replaceChild(textNode, el)
    }
  }
}

// --- MutationObserver ---

function startObserver(): void {
  if (observer) return
  observer = new MutationObserver((mutations) => {
    if (!active) return
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        try {
          if (IS_SCRAPBOX) {
            if (!(node instanceof HTMLElement)) continue
            // Ignore our own <ruby> insertions so we don't re-enter.
            if (node.classList.contains(SCRAPBOX_RUBY_CLASS)) continue
            if (node.closest(`ruby.${SCRAPBOX_RUBY_CLASS}`)) continue
            // Edits inside a line fire mutations on descendants of span.text;
            // walk up to the containing .text and reprocess it as a whole.
            const nearestText = node.closest?.("span.text") as HTMLElement | null
            if (nearestText) {
              void processScrapboxTextElement(nearestText).catch((e) => {
                if (e instanceof Error && e.message.includes("DeadObject")) return
                console.error("[yukari-rubi] scrapbox mutation error:", e)
              })
            }
            void processScrapboxRoot(node)
            continue
          }
          if (node instanceof HTMLElement && !node.classList.contains(CONTAINER_CLASS)) {
            void processRoot(node)
          } else if (node instanceof Text && node.textContent && containsCJK(node.textContent)) {
            void processTextNode(node)
          }
        } catch (e) {
          // Ignore DeadObject errors from mutations on destroyed/navigated pages
          if (e instanceof Error && e.message.includes("DeadObject")) continue
          throw e
        }
      }
    }
  })
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true })
  }
}

function stopObserver(): void {
  if (observer) {
    observer.disconnect()
    observer = null
  }
}

// --- Activate / Deactivate ---

function notifyStatus(): void {
  Browser.runtime.sendMessage({ type: "statusChanged", active })
}

async function activate(): Promise<void> {
  console.log("[yukari-rubi] Activating furigana on page:", location.href)
  active = true
  notifyStatus()
  if (processing) return
  processing = true
  try {
    // Ensure background script is ready before processing
    console.log("[yukari-rubi] Preloading background script...")
    await bg.preload()
    const settings = await bg.getSettings()
    console.log("[yukari-rubi] Settings:", settings)
    langSettings = {
      toggles: settings.languages ?? DEFAULT_LANGUAGES,
      zhStyle: settings.zhStyle ?? DEFAULT_ZH_STYLE,
      autoEnablePatterns: settings.autoEnablePatterns ?? [],
    }
    const rubySize = settings.rubySize ?? 50
    document.documentElement.style.setProperty("--yukari-ruby-size", String(rubySize))
    document.documentElement.setAttribute(
      "data-yukari-zhuyin-pos",
      settings.zhuyinPosition ?? "right",
    )
    console.log("[yukari-rubi] Processing document body...")
    await processRoot(document.body)
    if (settings.mutationObserver) {
      console.log("[yukari-rubi] Starting mutation observer...")
      startObserver()
    }
    console.log("[yukari-rubi] Activation complete")
  } catch (err) {
    // DeadObject errors in Firefox occur when interacting with destroyed context
    if (err instanceof Error && err.message.includes("DeadObject")) {
      return
    }
    console.error("[yukari-rubi] activation error:", err)
  } finally {
    processing = false
  }
}

function deactivate(): void {
  console.log("[yukari-rubi] Deactivating furigana")
  active = false
  notifyStatus()
  stopObserver()
  removeAnnotations()
}

async function toggle(): Promise<void> {
  if (active) {
    deactivate()
  } else {
    await activate()
  }
}

// --- Live update on storage change ---

Browser.storage.onChanged.addListener((changes) => {
  if (changes.rubySize?.newValue !== undefined) {
    document.documentElement.style.setProperty(
      "--yukari-ruby-size",
      String(changes.rubySize.newValue),
    )
  }
  if ("shortcut" in changes) {
    currentShortcut = (changes.shortcut.newValue as Shortcut | null | undefined) ?? null
  }
  if ("languages" in changes) {
    langSettings = {
      ...langSettings,
      toggles: (changes.languages.newValue as LanguageToggles | undefined) ?? DEFAULT_LANGUAGES,
    }
  }
  if ("zhStyle" in changes) {
    langSettings = {
      ...langSettings,
      zhStyle: (changes.zhStyle.newValue as ZhStyle | undefined) ?? DEFAULT_ZH_STYLE,
    }
  }
  if ("zhuyinPosition" in changes) {
    document.documentElement.setAttribute(
      "data-yukari-zhuyin-pos",
      (changes.zhuyinPosition.newValue as string | undefined) ?? "right",
    )
  }
  if ("autoEnablePatterns" in changes) {
    langSettings = {
      ...langSettings,
      autoEnablePatterns:
        (changes.autoEnablePatterns.newValue as AutoEnableEntry[] | undefined) ?? [],
    }
  }
})

// --- Keyboard shortcut ---

let currentShortcut: Shortcut | null = null

void Browser.storage.local.get("shortcut").then((result) => {
  // `undefined` means the default hasn't been seeded yet (first install in a
  // fresh profile); fall through as null — the background's onInstalled will
  // populate it and the onChanged listener above will pick it up.
  const stored = result.shortcut as Shortcut | null | undefined
  currentShortcut = stored ?? null
})

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
  if (target.isContentEditable) return true
  return false
}

function shortcutMatches(ev: KeyboardEvent, s: Shortcut): boolean {
  return (
    ev.ctrlKey === s.ctrl &&
    ev.altKey === s.alt &&
    ev.shiftKey === s.shift &&
    ev.metaKey === s.meta &&
    ev.key.toLowerCase() === s.key.toLowerCase()
  )
}

window.addEventListener(
  "keydown",
  (ev) => {
    const s = currentShortcut
    if (!s) return
    if (ev.isComposing) return
    if (isEditableTarget(ev.target)) return
    if (!shortcutMatches(ev, s)) return
    ev.preventDefault()
    ev.stopPropagation()
    void toggle()
  },
  true,
)

// --- Message listener ---

Browser.runtime.onMessage.addListener(
  (message: { type?: string; $birpc?: any }): Promise<unknown> | undefined => {
    // Skip birpc messages (handled by birpc client)
    if (message.$birpc) return undefined

    if (message.type === "toggle") {
      void toggle()
      return undefined
    }
    if (message.type === "activate") {
      if (!active) void activate()
      return undefined
    }
    if (message.type === "deactivate") {
      if (active) deactivate()
      return undefined
    }
    if (message.type === "getStatus") {
      return Promise.resolve({ active })
    }
    return undefined
  },
)

// --- Auto-enable on matching URLs ---

Browser.storage.local.get(["autoEnablePatterns"]).then((result) => {
  const entries = (result.autoEnablePatterns as AutoEnableEntry[] | undefined) ?? []
  const patterns = patternsOf(entries)
  if (patterns.length > 0 && urlMatchesPatterns(location.href, patterns)) {
    console.log("[yukari-rubi] URL matches auto-enable pattern, activating...")
    void activate()
  }
})
