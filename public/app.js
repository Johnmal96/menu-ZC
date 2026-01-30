const svgContainer = document.getElementById("svg-container");
const refreshButton = document.getElementById("refresh-button");
const saveButton = document.getElementById("save-button");
const menuSelect = document.getElementById("menu-select");
const statusElement = document.getElementById("status");

const KNOWN_MENUS = ["menu1.svg", "menu2.svg"];

function normalizeMenuFile(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "menu1.svg";
  const file = trimmed.replace(/^\/+/, "").replace(/^assets\//i, "");
  if (KNOWN_MENUS.includes(file)) return file;
  return "menu1.svg";
}

function toSvgUrl(menuFile) {
  return `/assets/${normalizeMenuFile(menuFile)}`;
}

let currentMenuFile = normalizeMenuFile(new URLSearchParams(window.location.search).get("svg"));
let currentSvgUrl = toSvgUrl(currentMenuFile);

let svgRoot = null;
let currentVisibleIds = [];
let currentPrices = {};

async function loadSvg() {
  statusElement.textContent = "Loading SVG...";
  const response = await fetch(currentSvgUrl);
  const svgText = await response.text();
  svgContainer.innerHTML = svgText;
  svgRoot = svgContainer.querySelector("svg");
  statusElement.textContent = "SVG loaded";
}

function applyVisibility(visibleIds) {
  if (!svgRoot) return;

  const visibleSet = new Set(visibleIds);
  const elements = svgRoot.querySelectorAll("[id]");

  elements.forEach((element) => {
    if (!isTargetId(element.id)) {
      return;
    }
    const isVisible = visibleSet.has(element.id);
    element.style.display = isVisible ? "inline" : "none";
  });
}

function applyPrices(prices) {
  if (!svgRoot) return;
  const map = prices && typeof prices === "object" ? prices : {};

  Object.entries(map).forEach(([id, value]) => {
    const element = svgRoot.querySelector(`#${CSS.escape(id)}`);
    if (!element) return;
    element.textContent = String(value ?? "");
  });
}

function isTargetId(value) {
  return /^[0-9]+(\.[0-9]+)*$/.test(String(value || "").trim());
}

async function refreshVisibility() {
  try {
    statusElement.textContent = "Fetching visibility...";
    const response = await fetch(`/api/visibility?svgUrl=${encodeURIComponent(currentSvgUrl)}`);
    const data = await response.json();
    const expanded = data.visibleIds || [];
    const raw = data.rawVisibleIds || [];
    const prices = data.prices || {};
    currentVisibleIds = expanded.length ? expanded : raw;
    currentPrices = prices;
    applyVisibility(currentVisibleIds);
    applyPrices(currentPrices);
    const displayIds = raw.length ? raw : currentVisibleIds;
    statusElement.textContent = `Visible IDs: ${displayIds.join(", ") || "none"}`;
  } catch (error) {
    console.error(error);
    statusElement.textContent = "Failed to load visibility.";
  }
}

refreshButton.addEventListener("click", refreshVisibility);

function setMenu(menuFile) {
  currentMenuFile = normalizeMenuFile(menuFile);
  currentSvgUrl = toSvgUrl(currentMenuFile);

  const url = new URL(window.location.href);
  url.searchParams.set("svg", currentMenuFile);
  window.history.replaceState({}, "", url);
}

menuSelect?.addEventListener("change", async (event) => {
  const next = event.target?.value;
  setMenu(next);
  await loadSvg();
  await refreshVisibility();
});
saveButton.addEventListener("click", async () => {
  if (!svgRoot) return;

  try {
    statusElement.textContent = "Preparing download...";
    const response = await fetch("/api/save-svg?download=1", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ svgUrl: currentSvgUrl, visibleIds: currentVisibleIds }),
    });

    if (!response.ok) {
      let message = "Failed to save SVG.";
      try {
        const data = await response.json();
        message = data?.error || message;
      } catch {
        // ignore
      }
      throw new Error(message);
    }

    const blob = await response.blob();
    const fileName = response.headers.get("X-File-Name") || "menu.png";
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
    statusElement.textContent = `Downloaded: ${fileName}`;
  } catch (error) {
    console.error(error);
    statusElement.textContent = "Failed to download PNG.";
  }
});

(async () => {
  if (menuSelect) {
    menuSelect.value = currentMenuFile;
  }
  await loadSvg();
  await refreshVisibility();
})();
