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
let currentRawVisibleIds = [];
let currentPrices = {};

const isIOS =
  /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
  // iPadOS reports as MacIntel but has touch points
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const usePngPreview = isIOS;
let previewImg = null;

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const contentType = String(response.headers.get("content-type") || "");
  const text = await response.text();

  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      const snippet = text.replace(/\s+/g, " ").slice(0, 200);
      throw new Error(
        `Expected JSON but got ${contentType || "unknown content-type"} (HTTP ${response.status}). ` +
          `This usually means the backend isn't being used (opened as a file / GitHub Pages) or the API route is missing. ` +
          `Response starts with: ${snippet}`,
      );
    }
  }

  return { response, data };
}

async function loadSvg() {
  if (usePngPreview) {
    statusElement.textContent = "Using iOS safe preview...";
    svgContainer.innerHTML = '<img id="png-preview" alt="Menu preview" style="max-width:100%; height:auto;" />';
    previewImg = document.getElementById("png-preview");
    svgRoot = null;
    statusElement.textContent = "Preview ready";
    return;
  }

  statusElement.textContent = "Loading SVG...";
  const response = await fetch(currentSvgUrl);
  if (!response.ok) {
    throw new Error(`Failed to load ${currentSvgUrl} (HTTP ${response.status}).`);
  }
  const svgText = await response.text();
  if (svgText.startsWith("version https://git-lfs.github.com/spec/v1")) {
    throw new Error(
      "This server is serving a Git LFS pointer instead of the real SVG. " +
        "If deployed to Render, add `git lfs install` + `git lfs pull` to the build command.",
    );
  }
  svgContainer.innerHTML = svgText;
  svgRoot = svgContainer.querySelector("svg");
  previewImg = null;
  statusElement.textContent = "SVG loaded";
}

function updatePreviewPng() {
  if (!usePngPreview) return;
  if (!previewImg) return;

  const ids = (currentRawVisibleIds || []).map((id) => String(id || "").trim()).filter(Boolean);
  const url = new URL("/api/preview-png", window.location.origin);
  url.searchParams.set("svgUrl", currentSvgUrl);
  url.searchParams.set("visibleIds", ids.join(","));
  url.searchParams.set("t", String(Date.now()));
  previewImg.src = url.toString();
}

function applyVisibility(visibleIds) {
  if (!svgRoot) return;

  const visibleSet = new Set((visibleIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  const elements = svgRoot.querySelectorAll("[id]");

  elements.forEach((element) => {
    if (!isTargetId(element.id)) {
      return;
    }
    const id = String(element.id || "");
    const base = id.split(".")[0];
    const isVisible = visibleSet.has(id) || (base && visibleSet.has(base));
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
    const { response, data } = await fetchJson(`/api/visibility?svgUrl=${encodeURIComponent(currentSvgUrl)}`);
    if (!response.ok) {
      throw new Error(data?.error || "Failed to load visibility.");
    }
    const raw = data.rawVisibleIds || [];
    const prices = data.prices || {};
    currentRawVisibleIds = raw;
    currentVisibleIds = raw;
    currentPrices = prices;
    applyVisibility(currentRawVisibleIds);
    applyPrices(currentPrices);
    updatePreviewPng();
    statusElement.textContent = `Visible IDs: ${currentRawVisibleIds.join(", ") || "none"}`;
  } catch (error) {
    console.error(error);
    statusElement.textContent = String(error?.message || "Failed to load visibility.");
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
  if (!svgRoot && !usePngPreview) return;

  try {
    statusElement.textContent = "Preparing download...";
    const response = await fetch("/api/save-svg?download=1", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ svgUrl: currentSvgUrl, visibleIds: currentRawVisibleIds }),
    });

    if (!response.ok) {
      const contentType = String(response.headers.get("content-type") || "");
      const text = await response.text();

      let message = `Failed to save SVG (HTTP ${response.status}).`;
      if (text) {
        try {
          const json = JSON.parse(text);
          message = String(json?.error || message);
        } catch {
          const snippet = text.replace(/\s+/g, " ").slice(0, 200);
          message = `Failed to save SVG (HTTP ${response.status}). Expected JSON but got ${contentType || "unknown"}. ` +
            `Response starts with: ${snippet}`;
        }
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
    statusElement.textContent = String(error?.message || "Failed to download PNG.");
  }
});

(async () => {
  if (menuSelect) {
    menuSelect.value = currentMenuFile;
  }
  await loadSvg();
  await refreshVisibility();
})();
