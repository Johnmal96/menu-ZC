const svgContainer = document.getElementById("svg-container");
const refreshButton = document.getElementById("refresh-button");
const saveButton = document.getElementById("save-button");
const saveDriveButton = document.getElementById("save-drive-button");
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

function getRenderSvgUrl() {
  const params = new URLSearchParams(window.location.search);
  const renderSvg = String(params.get("renderSvg") || "").trim();
  if (!renderSvg) return "";
  return toSvgUrl(renderSvg);
}

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
let previewObjectUrl = null;

async function fetchJson(url, options) {
  const maxRetries = 4;
  const retryStatuses = new Set([502, 503, 504]);

  async function sleep(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  let lastResponse = null;
  let lastText = "";

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetch(url, options);
    const contentType = String(response.headers.get("content-type") || "");
    const text = await response.text();

    lastResponse = response;
    lastText = text;

    // Render free instances can return a temporary 502/503 while waking up.
    if (retryStatuses.has(response.status) && attempt < maxRetries) {
      const delayMs = 500 * Math.pow(2, attempt);
      statusElement.textContent = `Waking server… retrying (${attempt + 1}/${maxRetries})`;
      await sleep(delayMs);
      continue;
    }

    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        const snippet = text.replace(/\s+/g, " ").slice(0, 200);
        if (response.status === 502 && /<title>\s*502\s*<\/title>/i.test(text)) {
          throw new Error(
            `Render returned HTTP 502 (HTML). This usually means the service is starting/sleeping or crashed. ` +
              `Wait ~20 seconds and refresh, then try again. Response starts with: ${snippet}`,
          );
        }
        throw new Error(
          `Expected JSON but got ${contentType || "unknown content-type"} (HTTP ${response.status}). ` +
            `This usually means the backend isn't being used (opened as a file / GitHub Pages) or the API route is missing. ` +
            `Response starts with: ${snippet}`,
        );
      }
    }

    return { response, data };
  }

  // Shouldn't be reachable, but keep a safe fallback.
  return { response: lastResponse, data: lastText ? null : null };
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

async function updatePreviewPng() {
  if (!usePngPreview) return;
  if (!previewImg) return;

  const ids = (currentRawVisibleIds || []).map((id) => String(id || "").trim()).filter(Boolean);
  const url = new URL("/api/preview-png", window.location.origin);
  url.searchParams.set("svgUrl", currentSvgUrl);
  const renderSvgUrl = getRenderSvgUrl();
  if (renderSvgUrl) {
    url.searchParams.set("renderSvgUrl", renderSvgUrl);
  }
  url.searchParams.set("visibleIds", ids.join(","));
  url.searchParams.set("t", String(Date.now()));

  try {
    const response = await fetch(url.toString(), { headers: { Accept: "image/png" } });
    if (!response.ok) {
      const contentType = String(response.headers.get("content-type") || "");
      const text = await response.text();

      let message = `Preview failed (HTTP ${response.status}).`;
      if (text) {
        try {
          message = String(JSON.parse(text)?.error || message);
        } catch {
          const snippet = text.replace(/\s+/g, " ").slice(0, 200);
          message = `Preview failed (HTTP ${response.status}). Expected image/png but got ${contentType || "unknown"}. ` +
            `Response starts with: ${snippet}`;
        }
      }

      statusElement.textContent = message;
      return;
    }

    const blob = await response.blob();
    if (previewObjectUrl) {
      URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = null;
    }
    previewObjectUrl = URL.createObjectURL(blob);
    previewImg.src = previewObjectUrl;
  } catch (error) {
    console.error(error);
    statusElement.textContent = String(error?.message || "Preview failed.");
  }
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
    await updatePreviewPng();
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
      body: JSON.stringify({
        svgUrl: currentSvgUrl,
        renderSvgUrl: getRenderSvgUrl() || undefined,
        visibleIds: currentRawVisibleIds,
      }),
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

    // iPad/iPhone: prefer the native Share Sheet so the user can AirDrop / Save to Photos / Save to Files.
    // This is more reliable than the <a download> path on iOS Safari.
    try {
      const canShareFiles =
        typeof navigator !== "undefined" &&
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function";

      if (canShareFiles) {
        const file = new File([blob], fileName, { type: "image/png" });
        if (navigator.canShare({ files: [file] })) {
          statusElement.textContent = "Opening share sheet...";
          await navigator.share({
            title: "Menu Image",
            text: "Menu PNG",
            files: [file],
          });
          statusElement.textContent = `Shared: ${fileName}`;
          return;
        }
      }
    } catch {
      // If the share sheet fails/cancels, fall back to download.
    }

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

saveDriveButton?.addEventListener("click", async () => {
  try {
    statusElement.textContent = "Uploading to Google Drive...";
    const { response, data } = await fetchJson("/api/save-drive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        svgUrl: currentSvgUrl,
        renderSvgUrl: getRenderSvgUrl() || undefined,
        visibleIds: currentRawVisibleIds,
      }),
    });

    if (!response.ok) {
      throw new Error(data?.error || `Failed to upload to Drive (HTTP ${response.status}).`);
    }

    const link = String(data?.webViewLink || data?.webContentLink || "").trim();
    if (link) {
      statusElement.textContent = "Uploaded to Drive. Opening link...";
      window.open(link, "_blank", "noopener");
      return;
    }

    const fileId = String(data?.fileId || "").trim();
    statusElement.textContent = fileId ? `Uploaded to Drive: ${fileId}` : "Uploaded to Drive.";
  } catch (error) {
    console.error(error);
    statusElement.textContent = String(error?.message || "Failed to upload to Drive.");
  }
});

(async () => {
  if (menuSelect) {
    menuSelect.value = currentMenuFile;
  }
  await loadSvg();
  await refreshVisibility();
})();
