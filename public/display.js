const img = document.getElementById("display-image");
const statusEl = document.getElementById("display-status");

let lastFileName = "";

async function poll() {
  try {
    const response = await fetch("/api/latest", { cache: "no-store" });
    if (!response.ok) {
      const text = await response.text();
      statusEl.textContent = `No image yet (HTTP ${response.status}). ${text || ""}`.trim();
      return;
    }

    const data = await response.json();
    const fileName = String(data?.fileName || "").trim();
    if (!fileName) {
      statusEl.textContent = "No image yet.";
      return;
    }

    if (fileName !== lastFileName) {
      lastFileName = fileName;
      const url = new URL("/api/latest-png", window.location.origin);
      url.searchParams.set("t", String(Date.now()));
      img.src = url.toString();
      statusEl.textContent = `Showing: ${fileName}`;
    }
  } catch (error) {
    statusEl.textContent = String(error?.message || "Failed to load latest image.");
  }
}

poll();
setInterval(poll, 2000);
