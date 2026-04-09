// sidebar.js - Peripheral browser, pin detail panel, search

import { peripheralColor, extractPeripheral } from "./conflicts.js";

/**
 * Render the sidebar with peripheral list and pin detail.
 * @param {HTMLElement} container
 * @param {import('./parser.js').McuData} mcuData
 * @param {import('./conflicts.js').AssignmentState} state
 * @param {Object} callbacks - { onHighlightPeripheral, onPinSelect, onAssign, onUnassign }
 * @returns {{ update: Function }}
 */
export function renderSidebar(container, mcuData, state, callbacks = {}) {
  container.innerHTML = "";

  // ── MCU Info Header ──
  const infoSection = el("div", "sidebar-section mcu-info");
  infoSection.innerHTML = `
    <h2>${mcuData.refName}</h2>
    <div class="mcu-meta">
      <span>${mcuData.core}</span>
      <span>${mcuData.frequency}MHz</span>
      <span>${mcuData.ram}KB RAM</span>
      <span>${mcuData.flash.join("/")}KB Flash</span>
      <span>${mcuData.package}</span>
      <span>${mcuData.ioCount} I/O</span>
    </div>
  `;
  container.appendChild(infoSection);

  // ── Search Box ──
  const searchSection = el("div", "sidebar-section search-section");
  const searchInput = el("input", "search-input");
  searchInput.type = "text";
  searchInput.placeholder = "Search pins or peripherals...";
  searchSection.appendChild(searchInput);
  container.appendChild(searchSection);

  // ── Peripheral List ──
  const periphSection = el("div", "sidebar-section periph-section");
  const periphHeader = el("div", "section-header");
  periphHeader.innerHTML = `<h3>Peripherals</h3><span class="periph-count">${Object.keys(mcuData.peripherals).length}</span>`;
  periphSection.appendChild(periphHeader);

  const periphList = el("div", "periph-list");
  periphSection.appendChild(periphList);
  container.appendChild(periphSection);

  // ── Pin Detail Panel ──
  const detailSection = el("div", "sidebar-section pin-detail-section");
  detailSection.style.display = "none";
  container.appendChild(detailSection);

  // ── Assignments Summary ──
  const assignSection = el("div", "sidebar-section assign-section");
  const assignHeader = el("div", "section-header");
  assignHeader.innerHTML = `<h3>Assignments</h3><span class="assign-count">0</span>`;
  assignSection.appendChild(assignHeader);
  const assignList = el("div", "assign-list");
  assignSection.appendChild(assignList);
  container.appendChild(assignSection);

  // State
  let currentFilter = "";
  let highlightedPeripheral = null;

  // ── Render peripherals ──
  function renderPeripherals() {
    periphList.innerHTML = "";
    const filter = currentFilter.toLowerCase();

    const entries = Object.entries(mcuData.peripherals);
    let visibleCount = 0;

    // Group by peripheral type (strip trailing digits)
    const groups = groupPeripherals(entries);

    for (const [groupName, peripherals] of groups) {
      // Check if any peripheral in group matches filter
      const matchingPeriphs = peripherals.filter(([name, signals]) => {
        if (!filter) return true;
        if (name.toLowerCase().includes(filter)) return true;
        return signals.some(s => s.toLowerCase().includes(filter));
      });

      if (matchingPeriphs.length === 0) continue;

      const groupEl = el("div", "periph-group");
      const groupHeader = el("div", "periph-group-header");
      groupHeader.textContent = groupName;
      groupEl.appendChild(groupHeader);

      for (const [periphName, signals] of matchingPeriphs) {
        visibleCount++;
        const item = el("div", "periph-item");
        const assigned = state.getPeripheralAssignments(periphName);

        // Color dot
        const dot = el("span", "periph-dot");
        dot.style.backgroundColor = peripheralColor(periphName);
        item.appendChild(dot);

        // Name
        const nameSpan = el("span", "periph-name");
        nameSpan.textContent = periphName;
        item.appendChild(nameSpan);

        // Signal count
        const countSpan = el("span", "periph-signal-count");
        countSpan.textContent = `${signals.length} signals`;
        item.appendChild(countSpan);

        // Assignment indicator
        if (assigned.length > 0) {
          const badge = el("span", "periph-assigned-badge");
          badge.textContent = `${assigned.length} assigned`;
          item.appendChild(badge);
        }

        // Highlight on hover
        item.addEventListener("mouseenter", () => {
          highlightedPeripheral = periphName;
          if (callbacks.onHighlightPeripheral) {
            callbacks.onHighlightPeripheral(periphName);
          }
          item.classList.add("active");
        });
        item.addEventListener("mouseleave", () => {
          highlightedPeripheral = null;
          if (callbacks.onHighlightPeripheral) {
            callbacks.onHighlightPeripheral(null);
          }
          item.classList.remove("active");
        });

        // Click to expand signals
        item.addEventListener("click", () => {
          togglePeriphDetail(item, periphName, signals, mcuData, state, callbacks);
        });

        groupEl.appendChild(item);
      }

      periphList.appendChild(groupEl);
    }

    // Update count
    periphSection.querySelector(".periph-count").textContent = visibleCount;
  }

  // ── Search handler ──
  searchInput.addEventListener("input", (e) => {
    currentFilter = e.target.value;
    renderPeripherals();
    // Also filter pin list if shown
  });

  // ── Pin detail panel ──
  function showPinDetail(pin) {
    detailSection.style.display = "block";
    detailSection.innerHTML = "";

    const header = el("div", "detail-header");
    const closeBtn = el("button", "detail-close");
    closeBtn.textContent = "\u00d7";
    closeBtn.addEventListener("click", () => {
      detailSection.style.display = "none";
      if (callbacks.onPinSelect) callbacks.onPinSelect(null);
    });

    header.innerHTML = `<h3>${pin.name}</h3><span class="detail-pos">Position ${pin.position}</span><span class="detail-type type-${pin.type.toLowerCase().replace(/\//g, "")}">${pin.type}</span>`;
    header.appendChild(closeBtn);
    detailSection.appendChild(header);

    if (pin.type !== "I/O") {
      const note = el("div", "detail-note");
      note.textContent = pin.type === "Power" ? "Power pin - no alternate functions" : `${pin.type} pin`;
      detailSection.appendChild(note);
      return;
    }

    const assignment = state.getAssignment(pin.name);

    // Signal list
    const sigList = el("div", "detail-signals");
    for (const sig of pin.signals) {
      if (sig.name === "GPIO") continue;

      const sigItem = el("div", "detail-signal-item");
      const isAssigned = assignment && assignment.signalName === sig.name;
      if (isAssigned) sigItem.classList.add("assigned");

      const periph = extractPeripheral(sig.name);
      const dot = el("span", "periph-dot");
      dot.style.backgroundColor = peripheralColor(periph);
      sigItem.appendChild(dot);

      const sigName = el("span", "detail-signal-name");
      sigName.textContent = sig.name;
      sigItem.appendChild(sigName);

      // Assign/unassign button
      const btn = el("button", "detail-assign-btn");
      if (isAssigned) {
        btn.textContent = "Unassign";
        btn.classList.add("btn-unassign");
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (callbacks.onUnassign) callbacks.onUnassign(pin.name);
          showPinDetail(pin); // refresh
        });
      } else {
        btn.textContent = "Assign";
        btn.classList.add("btn-assign");
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (callbacks.onAssign) callbacks.onAssign(pin.name, sig.name);
          showPinDetail(pin); // refresh
        });
      }
      sigItem.appendChild(btn);

      // Highlight peripheral on hover
      sigItem.addEventListener("mouseenter", () => {
        if (callbacks.onHighlightPeripheral) callbacks.onHighlightPeripheral(periph);
      });
      sigItem.addEventListener("mouseleave", () => {
        if (callbacks.onHighlightPeripheral) callbacks.onHighlightPeripheral(null);
      });

      sigList.appendChild(sigItem);
    }

    // GPIO entry
    const gpioSig = pin.signals.find(s => s.name === "GPIO");
    if (gpioSig) {
      const gpioItem = el("div", "detail-signal-item gpio-item");
      const dot = el("span", "periph-dot");
      dot.style.backgroundColor = "#888";
      gpioItem.appendChild(dot);
      const sigName = el("span", "detail-signal-name");
      sigName.textContent = `GPIO (${(gpioSig.ioModes || []).join(", ")})`;
      gpioItem.appendChild(sigName);
      sigList.appendChild(gpioItem);
    }

    detailSection.appendChild(sigList);
  }

  // ── Assignments summary ──
  function renderAssignments() {
    const assignments = state.getAllAssignments();
    assignList.innerHTML = "";
    assignSection.querySelector(".assign-count").textContent = assignments.length;

    if (assignments.length === 0) {
      const empty = el("div", "assign-empty");
      empty.textContent = "No pins assigned. Click a pin to assign functions.";
      assignList.appendChild(empty);
      return;
    }

    // Group by peripheral
    const byPeriph = new Map();
    for (const a of assignments) {
      const key = a.peripheral || "(GPIO)";
      if (!byPeriph.has(key)) byPeriph.set(key, []);
      byPeriph.get(key).push(a);
    }

    for (const [periph, assigns] of byPeriph) {
      const group = el("div", "assign-group");

      const header = el("div", "assign-group-header");
      const dot = el("span", "periph-dot");
      dot.style.backgroundColor = peripheralColor(periph);
      header.appendChild(dot);
      const nameSpan = el("span", "assign-group-name");
      nameSpan.textContent = periph;
      header.appendChild(nameSpan);
      group.appendChild(header);

      for (const a of assigns) {
        const row = el("div", "assign-row");
        row.innerHTML = `<span class="assign-pin">${a.pinName}</span><span class="assign-arrow">\u2192</span><span class="assign-signal">${a.signalName}</span>`;

        const removeBtn = el("button", "assign-remove");
        removeBtn.textContent = "\u00d7";
        removeBtn.addEventListener("click", () => {
          if (callbacks.onUnassign) callbacks.onUnassign(a.pinName);
        });
        row.appendChild(removeBtn);

        group.appendChild(row);
      }

      assignList.appendChild(group);
    }
  }

  // ── Initial render ──
  renderPeripherals();
  renderAssignments();

  // ── Public API ──
  return {
    update() {
      renderPeripherals();
      renderAssignments();
    },
    showPinDetail,
  };
}

/**
 * Toggle expanded detail for a peripheral in the list.
 */
function togglePeriphDetail(item, periphName, signals, mcuData, state, callbacks) {
  // Check if already expanded
  const existing = item.querySelector(".periph-detail-expand");
  if (existing) {
    existing.remove();
    return;
  }

  // Close other expanded items
  const parent = item.closest(".periph-list");
  if (parent) {
    parent.querySelectorAll(".periph-detail-expand").forEach(e => e.remove());
  }

  const expand = el("div", "periph-detail-expand");

  // Show which pins offer each signal
  for (const sigName of signals) {
    const row = el("div", "periph-detail-row");

    const sigSpan = el("span", "periph-detail-signal");
    sigSpan.textContent = sigName;
    sigSpan.title = sigName;
    row.appendChild(sigSpan);

    // Find all pins that have this signal
    const availPins = mcuData.pins.filter(p =>
      p.signals.some(s => s.name === sigName)
    );

    const pinsSpan = el("span", "periph-detail-pins");
    for (const pin of availPins) {
      const pinBtn = el("button", "periph-pin-btn");
      pinBtn.textContent = pin.name;
      pinBtn.title = pin.name;

      const assignment = state.getAssignment(pin.name);
      if (assignment && assignment.signalName === sigName) {
        pinBtn.classList.add("selected");
      } else if (assignment) {
        pinBtn.classList.add("occupied");
        pinBtn.title = `Assigned to ${assignment.signalName}`;
      }

      pinBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (assignment && assignment.signalName === sigName) {
          if (callbacks.onUnassign) callbacks.onUnassign(pin.name);
        } else {
          if (callbacks.onAssign) callbacks.onAssign(pin.name, sigName);
        }
      });

      pinsSpan.appendChild(pinBtn);
    }

    row.appendChild(pinsSpan);
    expand.appendChild(row);
  }

  item.appendChild(expand);
}

/**
 * Group peripherals by base type for cleaner display.
 * "USART1", "USART2", "USART3" → group "USART"
 * "SPI1", "SPI2" → group "SPI"
 * "ADC1", "ADC2" → group "ADC"
 */
function groupPeripherals(entries) {
  const groups = new Map();

  for (const [name, signals] of entries) {
    const base = name.replace(/\d+$/, "");
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push([name, signals]);
  }

  // Sort groups alphabetically, instances within each group naturally
  return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

// Helper
function el(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}
