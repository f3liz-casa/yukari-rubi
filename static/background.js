// @ts-nocheck — Background script (plain JS ESM, loaded by background.html)
import init, { Tokenizer } from "./wasm/sudachi_wasm.js";

let tokenizer = null;
let initPromise = null;

// --- IndexedDB dictionary cache ---

function openDictDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("yukari-rubi", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("dict");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadDictFromIDB() {
  try {
    const db = await openDictDB();
    return await new Promise((resolve) => {
      const tx = db.transaction("dict", "readonly");
      const req = tx.objectStore("dict").get("system_core");
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function saveDictToIDB(bytes) {
  try {
    const db = await openDictDB();
    const tx = db.transaction("dict", "readwrite");
    tx.objectStore("dict").put(bytes, "system_core");
  } catch (e) {
    console.warn("[yukari-rubi] Failed to cache dictionary:", e);
  }
}

// --- Tokenizer lifecycle ---

async function ensureTokenizer() {
  if (tokenizer) return tokenizer;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const wasmUrl = browser.runtime.getURL("wasm/sudachi_wasm_bg.wasm");
    await init(wasmUrl);

    // Try IndexedDB cache first
    let dictBytes = await loadDictFromIDB();

    if (!dictBytes) {
      // Fall back to bundled dictionary
      const dictUrl = browser.runtime.getURL("dict/system_core.dic");
      const resp = await fetch(dictUrl);
      if (!resp.ok) {
        throw new Error(
          "Dictionary not found. Place system_core.dic in dist/dict/",
        );
      }
      dictBytes = new Uint8Array(await resp.arrayBuffer());
      await saveDictToIDB(dictBytes);
    }

    tokenizer = new Tokenizer(dictBytes);
    return tokenizer;
  })();

  try {
    return await initPromise;
  } catch (err) {
    initPromise = null;
    throw err;
  }
}

// --- Default settings ---

browser.runtime.onInstalled.addListener(() => {
  browser.storage.local.get(["mutationObserver"]).then((current) => {
    if (current.mutationObserver === undefined) {
      browser.storage.local.set({ mutationObserver: false });
    }
  });
});

// --- Message handler ---

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "tokenize") {
    ensureTokenizer()
      .then((tok) => ({
        morphemes: tok.tokenize(message.text, message.mode ?? "A"),
      }))
      .catch((err) => ({ error: String(err.message ?? err) }))
      .then(sendResponse);
    return true;
  }

  if (message.type === "getSettings") {
    browser.storage.local.get(["mutationObserver"]).then(sendResponse);
    return true;
  }

  if (message.type === "setSettings") {
    browser.storage.local
      .set(message.settings)
      .then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "preload") {
    ensureTokenizer()
      .then(() => ({ ready: true }))
      .catch((err) => ({ ready: false, error: String(err.message ?? err) }))
      .then(sendResponse);
    return true;
  }

  return false;
});

// --- Keyboard shortcut ---

browser.commands.onCommand.addListener((command) => {
  if (command === "toggle-furigana") {
    browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId !== undefined) {
        browser.tabs.sendMessage(tabId, { type: "toggle" });
      }
    });
  }
});
