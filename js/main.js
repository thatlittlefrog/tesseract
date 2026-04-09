// main.js - Entry point, file loading, app state, wiring

import { parseMcuXml } from "./parser.js";
import { AssignmentState } from "./conflicts.js";
import { renderChip, createTooltip } from "./renderer.js";
import { renderSidebar } from "./sidebar.js";
import { exportJSON, exportCSV, exportText, exportFullPinout, downloadFile } from "./export.js";
import { fetchMcuList, fetchMcuXml, filterMcuList } from "./browser.js";

// ─── App State ──────────────────────────────────────────────────────────

const appState = {
  /** @type {import('./parser.js').McuData|null} */
  mcuData: null,
  assignments: new AssignmentState(),
  /** @type {{ svg: SVGElement, update: Function }|null} */
  chipView: null,
  /** @type {{ update: Function, showPinDetail: Function }|null} */
  sidebarView: null,
  highlightPeripheral: null,
  selectedPin: null,
};

// ─── DOM References ─────────────────────────────────────────────────────

const startScreen = document.getElementById("start-screen");
const chipContainer = document.getElementById("chip-container");
const sidebarContainer = document.getElementById("sidebar");
const toolbar = document.getElementById("toolbar");
const mainView = document.getElementById("main-view");

// ─── Tooltip ────────────────────────────────────────────────────────────

const tooltip = createTooltip();
let tooltipTimer = null;

// ─── MCU Browser ────────────────────────────────────────────────────────

const mcuSearch = document.getElementById("mcu-search");
const mcuResults = document.getElementById("mcu-results");
const mcuStatus = document.getElementById("mcu-status");

/** @type {string[]|null} */
let mcuList = null;
let activeResultIndex = -1;
let debounceTimer = null;

mcuSearch.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => handleSearch(mcuSearch.value), 150);
});

mcuSearch.addEventListener("keydown", (e) => {
  const items = mcuResults.querySelectorAll(".mcu-result-item");
  if (e.key === "ArrowDown") {
    e.preventDefault();
    activeResultIndex = Math.min(activeResultIndex + 1, items.length - 1);
    updateActiveResult(items);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    activeResultIndex = Math.max(activeResultIndex - 1, 0);
    updateActiveResult(items);
  } else if (e.key === "Enter" && activeResultIndex >= 0 && items[activeResultIndex]) {
    e.preventDefault();
    items[activeResultIndex].click();
  } else if (e.key === "Escape") {
    mcuResults.classList.remove("visible");
    mcuSearch.blur();
  }
});

function updateActiveResult(items) {
  items.forEach((el, i) => el.classList.toggle("active", i === activeResultIndex));
  if (items[activeResultIndex]) {
    items[activeResultIndex].scrollIntoView({ block: "nearest" });
  }
}

async function handleSearch(query) {
  activeResultIndex = -1;

  if (!query.trim()) {
    mcuResults.classList.remove("visible");
    mcuResults.innerHTML = "";
    mcuStatus.textContent = "";
    return;
  }

  // Fetch list on first search
  if (!mcuList) {
    mcuStatus.textContent = "Fetching MCU list from GitHub...";
    mcuStatus.className = "mcu-status";
    try {
      mcuList = await fetchMcuList();
      mcuStatus.textContent = `${mcuList.length} MCUs available`;
    } catch (err) {
      mcuStatus.textContent = err.message;
      mcuStatus.className = "mcu-status error";
      return;
    }
  }

  const matches = filterMcuList(mcuList, query);
  renderResults(matches, query);
}

function renderResults(matches, query) {
  mcuResults.innerHTML = "";

  if (matches.length === 0) {
    mcuResults.classList.remove("visible");
    return;
  }

  // Show count if many matches
  const display = matches.slice(0, 50);
  if (matches.length > 50) {
    const countEl = document.createElement("div");
    countEl.className = "mcu-result-count";
    countEl.textContent = `Showing 50 of ${matches.length} matches — keep typing to narrow`;
    mcuResults.appendChild(countEl);
  }

  for (const name of display) {
    const displayName = name.replace(/\.xml$/i, "");
    const item = document.createElement("div");
    item.className = "mcu-result-item";
    item.innerHTML = highlightMatch(displayName, query);
    item.addEventListener("click", () => {
      selectMcuFromBrowser(name, item);
    });
    mcuResults.appendChild(item);
  }

  mcuResults.classList.add("visible");
}

function highlightMatch(name, query) {
  const idx = name.toLowerCase().indexOf(query.toLowerCase().trim());
  if (idx === -1) return escapeHtml(name);
  const before = name.slice(0, idx);
  const match = name.slice(idx, idx + query.trim().length);
  const after = name.slice(idx + query.trim().length);
  return escapeHtml(before) + "<mark>" + escapeHtml(match) + "</mark>" + escapeHtml(after);
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function selectMcuFromBrowser(filename, itemEl) {
  // Show loading state
  itemEl.classList.add("loading");
  itemEl.textContent = `Loading ${filename}`;
  mcuSearch.disabled = true;

  try {
    const xmlText = await fetchMcuXml(filename);
    const mcuData = parseMcuXml(xmlText);

    appState.mcuData = mcuData;
    appState.assignments.clearAll();

    // Switch to main view
    startScreen.style.display = "none";
    mainView.style.display = "flex";
    toolbar.style.display = "flex";

    // Reset browser state for next time
    mcuSearch.value = "";
    mcuSearch.disabled = false;
    mcuResults.classList.remove("visible");
    mcuResults.innerHTML = "";
    mcuStatus.textContent = "";

    renderApp();
  } catch (err) {
    mcuStatus.textContent = `Failed to load ${filename}: ${err.message}`;
    mcuStatus.className = "mcu-status error";
    itemEl.classList.remove("loading");
    itemEl.textContent = filename;
    mcuSearch.disabled = false;
    console.error(err);
  }
}

// ─── App Rendering ──────────────────────────────────────────────────────

/** @type {Function|null} */
let _changeListener = null;

function renderApp() {
  const mcuData = appState.mcuData;
  if (!mcuData) return;

  // Remove old listener if re-rendering (e.g. loading a new chip)
  if (_changeListener) {
    appState.assignments.offChange(_changeListener);
  }

  // Render chip diagram
  appState.chipView = renderChip(chipContainer, mcuData, appState.assignments, {
    highlightPeripheral: appState.highlightPeripheral,
    highlightPin: appState.selectedPin,
    onPinClick: handlePinClick,
    onPinHover: handlePinHover,
  });

  // Render sidebar
  appState.sidebarView = renderSidebar(sidebarContainer, mcuData, appState.assignments, {
    onHighlightPeripheral: handleHighlightPeripheral,
    onPinSelect: handlePinSelect,
    onAssign: handleAssign,
    onUnassign: handleUnassign,
  });

  // Listen for assignment changes
  _changeListener = () => {
    if (appState.chipView) {
      appState.chipView.update({
        highlightPeripheral: appState.highlightPeripheral,
        highlightPin: appState.selectedPin,
      });
    }
    if (appState.sidebarView) {
      appState.sidebarView.update();
    }
  };
  appState.assignments.onChange(_changeListener);

  // Update document title
  document.title = `${mcuData.refName} - STM32 Pinout`;
}

// ─── Event Handlers ─────────────────────────────────────────────────────

function handlePinClick(pin, event) {
  appState.selectedPin = pin.name;
  if (appState.sidebarView) {
    appState.sidebarView.showPinDetail(pin);
  }
  if (appState.chipView) {
    appState.chipView.update({
      highlightPeripheral: appState.highlightPeripheral,
      highlightPin: appState.selectedPin,
    });
  }
}

function handlePinHover(pin) {
  if (!pin) {
    clearTimeout(tooltipTimer);
    tooltip.hide();
    return;
  }

  // Show tooltip after small delay
  clearTimeout(tooltipTimer);
  tooltipTimer = setTimeout(() => {
    const assignment = appState.assignments.getAssignment(pin.name);
    // Find pin SVG element position
    const pinGroup = chipContainer.querySelector(`[data-pin-name="${pin.name}"]`);
    if (pinGroup) {
      const rect = pinGroup.getBoundingClientRect();
      tooltip.show(pin, assignment, rect.right, rect.top);
    }
  }, 150);
}

function handleHighlightPeripheral(peripheral) {
  appState.highlightPeripheral = peripheral;
  if (appState.chipView) {
    appState.chipView.update({
      highlightPeripheral: peripheral,
      highlightPin: appState.selectedPin,
    });
  }
}

function handlePinSelect(pinName) {
  appState.selectedPin = pinName;
  if (appState.chipView) {
    appState.chipView.update({
      highlightPeripheral: appState.highlightPeripheral,
      highlightPin: pinName,
    });
  }
}

function handleAssign(pinName, signalName) {
  appState.assignments.assign(pinName, signalName);
}

function handleUnassign(pinName) {
  appState.assignments.unassign(pinName);
}

// ─── Toolbar Actions ────────────────────────────────────────────────────

document.getElementById("btn-load-new").addEventListener("click", () => {
  showStartScreen();
});

document.getElementById("btn-clear").addEventListener("click", () => {
  appState.assignments.clearAll();
});

document.getElementById("btn-export-json").addEventListener("click", () => {
  if (!appState.mcuData) return;
  const content = exportJSON(appState.mcuData, appState.assignments);
  downloadFile(content, `${appState.mcuData.refName}_pinout.json`, "application/json");
});

document.getElementById("btn-export-csv").addEventListener("click", () => {
  if (!appState.mcuData) return;
  const content = exportCSV(appState.mcuData, appState.assignments);
  downloadFile(content, `${appState.mcuData.refName}_pinout.csv`, "text/csv");
});

document.getElementById("btn-export-text").addEventListener("click", () => {
  if (!appState.mcuData) return;
  const content = exportText(appState.mcuData, appState.assignments);
  downloadFile(content, `${appState.mcuData.refName}_pinout.txt`, "text/plain");
});

document.getElementById("btn-export-full").addEventListener("click", () => {
  if (!appState.mcuData) return;
  const content = exportFullPinout(appState.mcuData, appState.assignments);
  downloadFile(content, `${appState.mcuData.refName}_full_pinout.csv`, "text/csv");
});

// ─── Keyboard Shortcuts ─────────────────────────────────────────────────

document.addEventListener("keydown", (e) => {
  // Escape: clear selection / close detail panel
  if (e.key === "Escape") {
    appState.selectedPin = null;
    appState.highlightPeripheral = null;
    if (appState.chipView) {
      appState.chipView.update({
        highlightPeripheral: null,
        highlightPin: null,
      });
    }
    const detailSection = document.querySelector(".pin-detail-section");
    if (detailSection) detailSection.style.display = "none";
  }

  // Ctrl+O: search for MCU
  if (e.key === "o" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    showStartScreen();
  }
});

// ─── Navigation ─────────────────────────────────────────────────────────

function showStartScreen() {
  mainView.style.display = "none";
  toolbar.style.display = "none";
  startScreen.style.display = "flex";
  mcuSearch.value = "";
  mcuResults.classList.remove("visible");
  mcuResults.innerHTML = "";
  mcuSearch.focus();
}
