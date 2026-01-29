const svgContainer = document.getElementById("svg-container");
const refreshButton = document.getElementById("refresh-button");
const saveButton = document.getElementById("save-button");
const statusElement = document.getElementById("status");
const SVG_URL = "/assets/menu1.svg";

let svgRoot = null;
let currentVisibleIds = [];
let currentPrices = {};

async function loadSvg() {
  statusElement.textContent = "Loading SVG...";
  const response = await fetch(SVG_URL);
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
    const response = await fetch("/api/visibility");
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
saveButton.addEventListener("click", async () => {
  if (!svgRoot) return;

  try {
    statusElement.textContent = "Saving SVG...";
    const response = await fetch("/api/save-svg", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ svgUrl: SVG_URL, visibleIds: currentVisibleIds }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to save SVG.");
    }

    statusElement.textContent = `Saved: ${data.fileName}`;
  } catch (error) {
    console.error(error);
    statusElement.textContent = "Failed to save SVG.";
  }
});

(async () => {
  await loadSvg();
  await refreshVisibility();
})();
