// main.js - Entry point, file loading, app state, wiring

import { parseMcuXml } from "./parser.js";
import { AssignmentState } from "./conflicts.js";
import { renderChip, createTooltip } from "./renderer.js";
import { renderSidebar } from "./sidebar.js";
import { exportJSON, exportCSV, exportText, exportFullPinout, downloadFile } from "./export.js";

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

const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const chipContainer = document.getElementById("chip-container");
const sidebarContainer = document.getElementById("sidebar");
const toolbar = document.getElementById("toolbar");
const mainView = document.getElementById("main-view");

// ─── Tooltip ────────────────────────────────────────────────────────────

const tooltip = createTooltip();
let tooltipTimer = null;

// ─── File Loading ───────────────────────────────────────────────────────

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("drag-over");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  const files = e.dataTransfer.files;
  if (files.length > 0) loadFile(files[0]);
});

dropZone.addEventListener("click", () => {
  fileInput.click();
});

fileInput.addEventListener("change", () => {
  if (fileInput.files.length > 0) {
    loadFile(fileInput.files[0]);
  }
});

async function loadFile(file) {
  if (!file.name.endsWith(".xml")) {
    showError("Please select an XML file from the STM32_open_pin_data repository.");
    return;
  }

  try {
    const text = await file.text();
    const mcuData = parseMcuXml(text);

    appState.mcuData = mcuData;
    appState.assignments.clearAll();

    // Switch to main view
    dropZone.style.display = "none";
    mainView.style.display = "flex";
    toolbar.style.display = "flex";

    renderApp();
  } catch (err) {
    showError(`Failed to parse ${file.name}: ${err.message}`);
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
  fileInput.click();
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

  // Ctrl+O: open file
  if (e.key === "o" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    fileInput.click();
  }
});

// ─── Error Display ──────────────────────────────────────────────────────

function showError(msg) {
  // Show in drop zone
  const errEl = dropZone.querySelector(".drop-error");
  if (errEl) {
    errEl.textContent = msg;
    errEl.style.display = "block";
    setTimeout(() => { errEl.style.display = "none"; }, 5000);
  } else {
    alert(msg);
  }
}
