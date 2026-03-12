const dot = document.getElementById("dot")!;
const statusText = document.getElementById("status-text")!;
const toggleBtn = document.getElementById("toggle-btn")!;
const mutationCb = document.getElementById("mutation-cb") as HTMLInputElement;
const errorEl = document.getElementById("error")!;

function updateUI(isActive: boolean): void {
  dot.classList.toggle("active", isActive);
  statusText.textContent = isActive ? "Active" : "Inactive";
  toggleBtn.textContent = isActive ? "Disable Furigana" : "Enable Furigana";
}

function showError(msg: string): void {
  errorEl.textContent = msg;
  errorEl.hidden = false;
}

async function init(): Promise<void> {
  try {
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    const tabId = tabs[0]?.id;
    if (tabId !== undefined) {
      try {
        const status: { active?: boolean } = await browser.tabs.sendMessage(
          tabId,
          { type: "getStatus" },
        );
        updateUI(status?.active ?? false);
      } catch {
        updateUI(false);
      }
    }

    const settings: { mutationObserver?: boolean } =
      await browser.storage.local.get(["mutationObserver"]);
    mutationCb.checked = settings.mutationObserver ?? false;
  } catch (err) {
    showError(String(err));
  }
}

toggleBtn.addEventListener("click", async () => {
  try {
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    const tabId = tabs[0]?.id;
    if (tabId !== undefined) {
      await browser.tabs.sendMessage(tabId, { type: "toggle" });
      await new Promise((r) => setTimeout(r, 150));
      try {
        const status: { active?: boolean } = await browser.tabs.sendMessage(
          tabId,
          { type: "getStatus" },
        );
        updateUI(status?.active ?? false);
      } catch {
        const wasInactive = statusText.textContent === "Inactive";
        updateUI(wasInactive);
      }
    }
  } catch (err) {
    showError(String(err));
  }
});

mutationCb.addEventListener("change", () => {
  void browser.storage.local.set({ mutationObserver: mutationCb.checked });
});

void init();
