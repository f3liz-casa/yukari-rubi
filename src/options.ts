import Browser from "webextension-polyfill"
import { DEFAULT_SHORTCUT } from "./types"
import type { Shortcut, UserDictEntry } from "./types"

const shortcutEnableCb = document.getElementById("shortcut-enable-cb") as HTMLInputElement
const shortcutInput = document.getElementById("shortcut-input") as HTMLInputElement
const shortcutClearBtn = document.getElementById("shortcut-clear")!
const shortcutResetBtn = document.getElementById("shortcut-reset")!

const dictSurfaceInput = document.getElementById("dict-surface-input") as HTMLInputElement
const dictReadingInput = document.getElementById("dict-reading-input") as HTMLInputElement
const dictAddBtn = document.getElementById("dict-add-btn")!
const dictTableEl = document.getElementById("dict-table") as HTMLTableElement
const dictTbodyEl = document.getElementById("dict-tbody")!
const dictEmptyEl = document.getElementById("dict-empty")!
const dictErrorEl = document.getElementById("dict-error")!

function t(key: string): string {
  return Browser.i18n.getMessage(key) || key
}

function applyI18n(): void {
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = el.dataset.i18n!
    const msg = t(key)
    if (msg !== key) el.textContent = msg
  }
  for (const el of document.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]")) {
    const key = el.dataset.i18nPlaceholder!
    const msg = t(key)
    if (msg !== key) el.placeholder = msg
  }
  document.title = t("optionsTitle")
}

// --- Shortcut ---

let currentShortcut: Shortcut | null = null

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta", "OS", "AltGraph"])

function formatShortcut(s: Shortcut | null): string {
  if (!s) return t("shortcutDisabled")
  const parts: string[] = []
  if (s.ctrl) parts.push("Ctrl")
  if (s.alt) parts.push("Alt")
  if (s.shift) parts.push("Shift")
  if (s.meta) parts.push("Meta")
  parts.push(s.key.length === 1 ? s.key.toUpperCase() : s.key)
  return parts.join(" + ")
}

function renderShortcut(): void {
  const enabled = currentShortcut !== null
  shortcutEnableCb.checked = enabled
  shortcutInput.value = formatShortcut(currentShortcut)
  shortcutInput.classList.toggle("disabled", !enabled)
  shortcutInput.disabled = !enabled
}

function saveShortcut(): void {
  void Browser.storage.local.set({ shortcut: currentShortcut })
}

shortcutEnableCb.addEventListener("change", () => {
  if (shortcutEnableCb.checked) {
    if (!currentShortcut) currentShortcut = { ...DEFAULT_SHORTCUT }
  } else {
    currentShortcut = null
  }
  saveShortcut()
  renderShortcut()
})

shortcutInput.addEventListener("keydown", (ev) => {
  ev.preventDefault()
  ev.stopPropagation()
  if (MODIFIER_KEYS.has(ev.key)) return
  if (ev.key === "Escape" || ev.key === "Tab") {
    shortcutInput.blur()
    return
  }
  currentShortcut = {
    ctrl: ev.ctrlKey,
    alt: ev.altKey,
    shift: ev.shiftKey,
    meta: ev.metaKey,
    key: ev.key.length === 1 ? ev.key.toLowerCase() : ev.key,
  }
  saveShortcut()
  renderShortcut()
  shortcutInput.blur()
})

shortcutClearBtn.addEventListener("click", () => {
  currentShortcut = null
  saveShortcut()
  renderShortcut()
})

shortcutResetBtn.addEventListener("click", () => {
  currentShortcut = { ...DEFAULT_SHORTCUT }
  saveShortcut()
  renderShortcut()
})

// --- User dictionary ---

let userDictionary: UserDictEntry[] = []

const KANJI_RE = /[\u3400-\u9FFF\uF900-\uFAFF\u3005\u303B]/

function showDictError(msg: string): void {
  dictErrorEl.textContent = msg
  dictErrorEl.hidden = false
}

function clearDictError(): void {
  dictErrorEl.textContent = ""
  dictErrorEl.hidden = true
}

function renderDictionary(): void {
  dictTbodyEl.innerHTML = ""
  if (userDictionary.length === 0) {
    dictTableEl.hidden = true
    dictEmptyEl.hidden = false
    return
  }
  dictTableEl.hidden = false
  dictEmptyEl.hidden = true
  for (const entry of userDictionary) {
    const tr = document.createElement("tr")
    const surfaceTd = document.createElement("td")
    surfaceTd.className = "surface"
    surfaceTd.textContent = entry.surface
    const readingTd = document.createElement("td")
    readingTd.className = "reading"
    readingTd.textContent = entry.reading
    const actionTd = document.createElement("td")
    actionTd.className = "action"
    const btn = document.createElement("button")
    btn.textContent = t("userDictRemove")
    btn.addEventListener("click", () => removeDictEntry(entry.surface))
    actionTd.appendChild(btn)
    tr.appendChild(surfaceTd)
    tr.appendChild(readingTd)
    tr.appendChild(actionTd)
    dictTbodyEl.appendChild(tr)
  }
}

function saveDictionary(): void {
  void Browser.storage.local.set({ userDictionary })
}

function addDictEntry(surface: string, reading: string): void {
  const s = surface.trim()
  const r = reading.trim()
  if (!s || !KANJI_RE.test(s)) {
    showDictError(t("userDictInvalidSurface"))
    return
  }
  if (!r) {
    showDictError(t("userDictInvalidReading"))
    return
  }
  const existing = userDictionary.findIndex((e) => e.surface === s)
  if (existing >= 0) {
    userDictionary[existing] = { surface: s, reading: r }
  } else {
    userDictionary.push({ surface: s, reading: r })
  }
  clearDictError()
  saveDictionary()
  renderDictionary()
}

function removeDictEntry(surface: string): void {
  userDictionary = userDictionary.filter((e) => e.surface !== surface)
  saveDictionary()
  renderDictionary()
}

dictAddBtn.addEventListener("click", () => {
  addDictEntry(dictSurfaceInput.value, dictReadingInput.value)
  if (dictErrorEl.hidden) {
    dictSurfaceInput.value = ""
    dictReadingInput.value = ""
    dictSurfaceInput.focus()
  }
})

for (const input of [dictSurfaceInput, dictReadingInput]) {
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      addDictEntry(dictSurfaceInput.value, dictReadingInput.value)
      if (dictErrorEl.hidden) {
        dictSurfaceInput.value = ""
        dictReadingInput.value = ""
        dictSurfaceInput.focus()
      }
    }
  })
}

// --- Init ---

async function init(): Promise<void> {
  applyI18n()
  const settings = await Browser.storage.local.get(["shortcut", "userDictionary"])
  currentShortcut = (settings.shortcut as Shortcut | null | undefined) ?? null
  renderShortcut()
  userDictionary = (settings.userDictionary as UserDictEntry[] | undefined) ?? []
  renderDictionary()
}

// Live-refresh when changed from another surface (popup, other options tab).
Browser.storage.onChanged.addListener((changes) => {
  if ("shortcut" in changes) {
    currentShortcut = (changes.shortcut.newValue as Shortcut | null | undefined) ?? null
    renderShortcut()
  }
  if ("userDictionary" in changes) {
    userDictionary = (changes.userDictionary.newValue as UserDictEntry[] | undefined) ?? []
    renderDictionary()
  }
})

void init()
