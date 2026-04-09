// renderer.js - SVG chip diagram rendering

import { peripheralColor } from "./conflicts.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// Layout constants
const PIN_WIDTH = 12;
const PIN_LENGTH = 28;
const PIN_SPACING = 22;
const PIN_FONT_SIZE = 9;
const LABEL_FONT_SIZE = 8.5;
const CHIP_PADDING = 60;      // space around chip for labels
const CHIP_CORNER = 6;        // rounded corners on chip body
const PIN1_MARKER_R = 4;      // pin 1 dot radius
const BGA_BALL_R = 8;
const BGA_SPACING = 26;

/**
 * Render the chip diagram into a container element.
 * @param {HTMLElement} container - DOM element to render into
 * @param {import('./parser.js').McuData} mcuData
 * @param {import('./conflicts.js').AssignmentState} state
 * @param {Object} opts - { highlightPeripheral?: string, highlightPin?: string, onPinClick: fn, onPinHover: fn }
 * @returns {Object} - { svg, update() }
 */
export function renderChip(container, mcuData, state, opts = {}) {
  container.innerHTML = "";

  const layout = computeLayout(mcuData);
  const svg = createSvg(layout.svgWidth, layout.svgHeight);
  container.appendChild(svg);

  // Chip body
  const body = createChipBody(layout);
  svg.appendChild(body);

  // Pin 1 marker
  if (layout.pin1Marker) {
    const marker = createCircle(layout.pin1Marker.x, layout.pin1Marker.y, PIN1_MARKER_R, "pin1-marker");
    svg.appendChild(marker);
  }

  // Chip label (center)
  const labelGroup = createChipLabel(mcuData, layout);
  svg.appendChild(labelGroup);

  // Render each pin
  const pinElements = new Map();
  for (const pinLayout of layout.pins) {
    const g = renderPin(pinLayout, mcuData, state, opts);
    svg.appendChild(g);
    pinElements.set(pinLayout.pin.name, { group: g, layout: pinLayout });
  }

  // Update function to refresh colors/highlights without re-rendering
  function update(newOpts = {}) {
    const mergedOpts = { ...opts, ...newOpts };
    for (const [pinName, { group, layout: pl }] of pinElements) {
      updatePinVisuals(group, pl, mcuData, state, mergedOpts);
    }
  }

  return { svg, update, layout };
}

/**
 * Compute the physical layout of all pins based on package type.
 */
function computeLayout(mcuData) {
  switch (mcuData.packageType) {
    case "BGA":
      return computeBgaLayout(mcuData);
    case "SOP":
      return computeSopLayout(mcuData);
    default:
      return computeQfpLayout(mcuData);
  }
}

// ─── QFP Layout (4-sided: LQFP, QFP, QFN, UFQFPN) ─────────────────────

function computeQfpLayout(mcuData) {
  const total = mcuData.pins.length;
  const perSide = Math.ceil(total / 4);

  const chipW = perSide * PIN_SPACING + 20;
  const chipH = chipW; // square package
  // Extra margin for rotated pin name labels
  const labelMargin = 80;
  const svgWidth = chipW + labelMargin * 2 + PIN_LENGTH * 2;
  const svgHeight = chipH + labelMargin * 2 + PIN_LENGTH * 2;

  const chipX = labelMargin + PIN_LENGTH;
  const chipY = labelMargin + PIN_LENGTH;

  // Sort pins by position (integer)
  const sorted = [...mcuData.pins].sort((a, b) => parseInt(a.position) - parseInt(b.position));

  // LQFP standard: pin 1 at top-left of left side, going CCW:
  //   Left (top→bottom) → Bottom (left→right) → Right (bottom→top) → Top (right→left)
  // Side mapping: 0=left, 1=bottom, 2=right, 3=top
  const pins = [];
  for (let i = 0; i < sorted.length; i++) {
    const pin = sorted[i];
    const side = Math.floor(i / perSide);
    const idx = i % perSide;
    const pl = computeQfpPinPosition(side, idx, perSide, chipX, chipY, chipW, chipH);
    pl.pin = pin;
    pins.push(pl);
  }

  // Pin 1 marker inside chip body near pin 1 (top-left)
  const pin1Marker = {
    x: chipX + 12,
    y: chipY + 12,
  };

  return {
    svgWidth, svgHeight,
    chipX, chipY, chipW, chipH,
    pins, pin1Marker,
    type: "QFP",
  };
}

function computeQfpPinPosition(side, idx, perSide, chipX, chipY, chipW, chipH) {
  const startOffset = 10;

  switch (side) {
    case 0: // Left side, top to bottom (pin 1 starts here)
      return {
        x: chipX - PIN_LENGTH,
        y: chipY + startOffset + idx * PIN_SPACING,
        w: PIN_LENGTH,
        h: PIN_WIDTH,
        labelSide: "left",
        side: "left",
      };
    case 1: // Bottom side, left to right
      return {
        x: chipX + startOffset + idx * PIN_SPACING,
        y: chipY + chipH,
        w: PIN_WIDTH,
        h: PIN_LENGTH,
        labelSide: "bottom",
        side: "bottom",
      };
    case 2: // Right side, bottom to top
      return {
        x: chipX + chipW,
        y: chipY + chipH - startOffset - idx * PIN_SPACING,
        w: PIN_LENGTH,
        h: PIN_WIDTH,
        labelSide: "right",
        side: "right",
      };
    case 3: // Top side, right to left
      return {
        x: chipX + chipW - startOffset - (idx + 1) * PIN_SPACING,
        y: chipY - PIN_LENGTH,
        w: PIN_WIDTH,
        h: PIN_LENGTH,
        labelSide: "top",
        side: "top",
      };
    default:
      return { x: 0, y: 0, w: PIN_WIDTH, h: PIN_LENGTH, labelSide: "left", side: "left" };
  }
}

// ─── SOP Layout (2-sided: TSSOP, SOP) ───────────────────────────────────

function computeSopLayout(mcuData) {
  const total = mcuData.pins.length;
  const perSide = Math.ceil(total / 2);

  const chipW = 80;
  const chipH = perSide * PIN_SPACING + 20;
  const labelMargin = 100;
  const svgWidth = chipW + labelMargin * 2 + PIN_LENGTH * 2;
  const svgHeight = chipH + CHIP_PADDING * 2;

  const chipX = labelMargin + PIN_LENGTH;
  const chipY = CHIP_PADDING;

  const sorted = [...mcuData.pins].sort((a, b) => parseInt(a.position) - parseInt(b.position));

  const pins = [];
  for (let i = 0; i < sorted.length; i++) {
    const pin = sorted[i];
    const side = i < perSide ? 0 : 1; // 0=left, 1=right
    const idx = side === 0 ? i : (total - 1 - i);

    const startOffset = 10;
    let pl;
    if (side === 0) {
      // Left side, top to bottom
      pl = {
        x: chipX - PIN_LENGTH,
        y: chipY + startOffset + idx * PIN_SPACING,
        w: PIN_LENGTH,
        h: PIN_WIDTH,
        labelSide: "left",
        side: "left",
      };
    } else {
      // Right side, bottom to top
      pl = {
        x: chipX + chipW,
        y: chipY + startOffset + idx * PIN_SPACING,
        w: PIN_LENGTH,
        h: PIN_WIDTH,
        labelSide: "right",
        side: "right",
      };
    }
    pl.pin = pin;
    pins.push(pl);
  }

  const pin1Marker = { x: chipX + 12, y: chipY + 12 };

  return {
    svgWidth, svgHeight,
    chipX, chipY, chipW, chipH,
    pins, pin1Marker,
    type: "SOP",
  };
}

// ─── BGA Layout (grid: VFBGA, UFBGA, TFBGA, WLCSP) ────────────────────

function computeBgaLayout(mcuData) {
  // BGA positions are like "A1", "B2", "M12".
  // BGA packages skip letters (I, O, Q, S, X, Z) so we can't just convert
  // letters to sequential indices. Instead, collect all unique row/col values
  // from the actual data and build a dense mapping.

  const sorted = [...mcuData.pins];

  // Parse raw positions: { rowLabel: "A", col: 1 }
  const rawPositions = sorted.map(pin => parseBgaPosition(pin.position));

  // Collect unique row labels and column numbers, then sort them
  const rowLabels = [...new Set(rawPositions.map(p => p.rowLabel))].sort();
  const colNumbers = [...new Set(rawPositions.map(p => p.col))].sort((a, b) => a - b);

  // Build dense index maps: "A" → 0, "B" → 1, "H" → 7, "J" → 8 (no gap for missing I)
  const rowIndex = new Map();
  rowLabels.forEach((label, i) => rowIndex.set(label, i));
  const colIndex = new Map();
  colNumbers.forEach((num, i) => colIndex.set(num, i));

  const gridW = colNumbers.length;
  const gridH = rowLabels.length;

  // Chip body sized to center the ball grid with even padding
  const bgaPad = 22;
  const chipW = (gridW - 1) * BGA_SPACING + 2 * bgaPad;
  const chipH = (gridH - 1) * BGA_SPACING + 2 * bgaPad;
  const svgWidth = chipW + CHIP_PADDING * 2;
  const svgHeight = chipH + CHIP_PADDING * 2 + 60; // extra space for label below
  const chipX = CHIP_PADDING;
  const chipY = CHIP_PADDING;

  // Grid origin: balls are centered within the chip body
  const gridStartX = chipX + bgaPad;
  const gridStartY = chipY + bgaPad;

  const pins = [];
  for (let i = 0; i < sorted.length; i++) {
    const pin = sorted[i];
    const raw = rawPositions[i];
    const r = rowIndex.get(raw.rowLabel);
    const c = colIndex.get(raw.col);
    pins.push({
      x: gridStartX + c * BGA_SPACING,
      y: gridStartY + r * BGA_SPACING,
      w: BGA_BALL_R * 2,
      h: BGA_BALL_R * 2,
      labelSide: "center",
      side: "center",
      isBga: true,
      bgaLabel: pin.position,
      pin,
    });
  }

  // Pin A1 marker
  const pin1Marker = { x: chipX + 6, y: chipY + 6 };

  return {
    svgWidth, svgHeight,
    chipX, chipY, chipW, chipH,
    pins, pin1Marker,
    type: "BGA",
    gridW, gridH,
  };
}

/**
 * Parse a BGA position string into row label + column number.
 * "A1" → { rowLabel: "A", col: 1 }
 * "M12" → { rowLabel: "M", col: 12 }
 * "AA3" → { rowLabel: "AA", col: 3 }
 */
function parseBgaPosition(pos) {
  const match = pos.match(/^([A-Z]+)(\d+)$/i);
  if (!match) {
    // Fallback for numeric-only positions (shouldn't happen for BGA)
    const n = parseInt(pos, 10) || 0;
    return { rowLabel: String.fromCharCode(65 + Math.floor(n / 20)), col: (n % 20) + 1 };
  }
  return {
    rowLabel: match[1].toUpperCase(),
    col: parseInt(match[2], 10),
  };
}

// ─── SVG Element Creation ───────────────────────────────────────────────

function createSvg(width, height) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.classList.add("chip-svg");
  return svg;
}

function createChipBody(layout) {
  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("x", layout.chipX);
  rect.setAttribute("y", layout.chipY);
  rect.setAttribute("width", layout.chipW);
  rect.setAttribute("height", layout.chipH);
  rect.setAttribute("rx", CHIP_CORNER);
  rect.setAttribute("ry", CHIP_CORNER);
  rect.classList.add("chip-body");
  return rect;
}

function createCircle(cx, cy, r, className) {
  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("cx", cx);
  circle.setAttribute("cy", cy);
  circle.setAttribute("r", r);
  if (className) circle.classList.add(className);
  return circle;
}

function createChipLabel(mcuData, layout) {
  const g = document.createElementNS(SVG_NS, "g");
  const cx = layout.chipX + layout.chipW / 2;

  // For BGA, place label below the chip body to avoid overlapping balls
  const isBga = layout.type === "BGA";
  const cy = isBga
    ? layout.chipY + layout.chipH + 28
    : layout.chipY + layout.chipH / 2;

  // MCU name
  const name = document.createElementNS(SVG_NS, "text");
  name.setAttribute("x", cx);
  name.setAttribute("y", cy - 12);
  name.setAttribute("text-anchor", "middle");
  name.classList.add("chip-label-name");
  name.textContent = mcuData.refName;
  g.appendChild(name);

  // Package
  const pkg = document.createElementNS(SVG_NS, "text");
  pkg.setAttribute("x", cx);
  pkg.setAttribute("y", cy + 6);
  pkg.setAttribute("text-anchor", "middle");
  pkg.classList.add("chip-label-pkg");
  pkg.textContent = mcuData.package;
  g.appendChild(pkg);

  // Core + freq
  const info = document.createElementNS(SVG_NS, "text");
  info.setAttribute("x", cx);
  info.setAttribute("y", cy + 22);
  info.setAttribute("text-anchor", "middle");
  info.classList.add("chip-label-info");
  info.textContent = `${mcuData.core} @ ${mcuData.frequency}MHz`;
  g.appendChild(info);

  return g;
}

// ─── Individual Pin Rendering ───────────────────────────────────────────

function renderPin(pinLayout, mcuData, state, opts) {
  const g = document.createElementNS(SVG_NS, "g");
  g.classList.add("pin-group");
  g.dataset.pinName = pinLayout.pin.name;

  if (pinLayout.isBga) {
    // BGA: circle ball
    const ball = createCircle(
      pinLayout.x, pinLayout.y, BGA_BALL_R, "pin-ball"
    );
    g.appendChild(ball);

    // Ball label (position like "A1")
    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("x", pinLayout.x);
    label.setAttribute("y", pinLayout.y + 3);
    label.setAttribute("text-anchor", "middle");
    label.classList.add("pin-bga-label");
    label.textContent = pinLayout.bgaLabel;
    g.appendChild(label);

    // Pin name label (outside ball)
    // Only show on hover for BGA to avoid clutter
  } else {
    // QFP/SOP: rectangle pad
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", pinLayout.x);
    rect.setAttribute("y", pinLayout.y);
    rect.setAttribute("width", pinLayout.w);
    rect.setAttribute("height", pinLayout.h);
    rect.setAttribute("rx", 1);
    rect.classList.add("pin-pad");
    g.appendChild(rect);

    // Pin name label (outside the chip body)
    const label = createPinLabel(pinLayout);
    g.appendChild(label);

    // Assignment label (between pin and name label, shows assigned function)
    const assignLabel = createAssignmentLabel(pinLayout);
    assignLabel.classList.add("pin-assignment-label");
    g.appendChild(assignLabel);
  }

  // Set initial visuals
  updatePinVisuals(g, pinLayout, mcuData, state, opts);

  // Event handlers
  g.addEventListener("click", (e) => {
    if (opts.onPinClick) opts.onPinClick(pinLayout.pin, e);
  });
  g.addEventListener("mouseenter", () => {
    if (opts.onPinHover) opts.onPinHover(pinLayout.pin);
    g.classList.add("hovered");
  });
  g.addEventListener("mouseleave", () => {
    if (opts.onPinHover) opts.onPinHover(null);
    g.classList.remove("hovered");
  });

  return g;
}

function createPinLabel(pinLayout) {
  const text = document.createElementNS(SVG_NS, "text");
  text.classList.add("pin-name-label");

  // All sides: rotated labels extending outward from the chip body.
  // Each label uses ~font-height of space along the chip edge (parallel),
  // and extends outward (perpendicular) as far as the name requires.
  const pad = 4;
  switch (pinLayout.side) {
    case "bottom": {
      const cx = pinLayout.x + PIN_WIDTH / 2;
      const cy = pinLayout.y + PIN_LENGTH + pad;
      text.setAttribute("x", cx);
      text.setAttribute("y", cy);
      text.setAttribute("text-anchor", "end");
      text.setAttribute("transform", `rotate(90, ${cx}, ${cy})`);
      break;
    }
    case "top": {
      const cx = pinLayout.x + PIN_WIDTH / 2;
      const cy = pinLayout.y - pad;
      text.setAttribute("x", cx);
      text.setAttribute("y", cy);
      text.setAttribute("text-anchor", "end");
      text.setAttribute("transform", `rotate(-90, ${cx}, ${cy})`);
      break;
    }
    case "left": {
      const cx = pinLayout.x - pad;
      const cy = pinLayout.y + PIN_WIDTH / 2 + 3;
      text.setAttribute("x", cx);
      text.setAttribute("y", cy);
      text.setAttribute("text-anchor", "end");
      // no rotation: extends horizontally to the left
      break;
    }
    case "right": {
      const cx = pinLayout.x + PIN_LENGTH + pad;
      const cy = pinLayout.y + PIN_WIDTH / 2 + 3;
      text.setAttribute("x", cx);
      text.setAttribute("y", cy);
      text.setAttribute("text-anchor", "start");
      // no rotation: extends horizontally to the right
      break;
    }
  }

  text.textContent = shortPinName(pinLayout.pin.name);
  return text;
}

function createAssignmentLabel(pinLayout) {
  const text = document.createElementNS(SVG_NS, "text");
  text.classList.add("pin-assignment-label");

  // Placed next to the pin name label (offset along chip edge direction)
  const pad = 4;
  const nameOffset = 11;
  switch (pinLayout.side) {
    case "bottom": {
      const cx = pinLayout.x + PIN_WIDTH / 2 + nameOffset;
      const cy = pinLayout.y + PIN_LENGTH + pad;
      text.setAttribute("x", cx);
      text.setAttribute("y", cy);
      text.setAttribute("text-anchor", "end");
      text.setAttribute("transform", `rotate(90, ${cx}, ${cy})`);
      break;
    }
    case "top": {
      const cx = pinLayout.x + PIN_WIDTH / 2 - nameOffset;
      const cy = pinLayout.y - pad;
      text.setAttribute("x", cx);
      text.setAttribute("y", cy);
      text.setAttribute("text-anchor", "end");
      text.setAttribute("transform", `rotate(-90, ${cx}, ${cy})`);
      break;
    }
    case "left": {
      const cx = pinLayout.x - pad;
      const cy = pinLayout.y + PIN_WIDTH / 2 + 3 + nameOffset;
      text.setAttribute("x", cx);
      text.setAttribute("y", cy);
      text.setAttribute("text-anchor", "end");
      break;
    }
    case "right": {
      const cx = pinLayout.x + PIN_LENGTH + pad;
      const cy = pinLayout.y + PIN_WIDTH / 2 + 3 + nameOffset;
      text.setAttribute("x", cx);
      text.setAttribute("y", cy);
      text.setAttribute("text-anchor", "start");
      break;
    }
  }

  text.textContent = "";
  return text;
}

/**
 * Shorten a pin name for display on the diagram.
 * "PF0-OSC_IN" → "PF0", "PC14-OSC32_IN" → "PC14"
 * Keeps non-GPIO names as-is: "VDD", "NRST", "VBAT"
 */
function shortPinName(name) {
  // GPIO-style names: Pxnn-SOMETHING → strip the suffix
  const match = name.match(/^(P[A-Z]\d+)/);
  if (match) return match[1];
  return name;
}

// ─── Pin Visual Updates ─────────────────────────────────────────────────

function updatePinVisuals(group, pinLayout, mcuData, state, opts) {
  const pin = pinLayout.pin;
  const assignment = state.getAssignment(pin.name);
  const highlightPeripheral = opts.highlightPeripheral || null;
  const highlightPin = opts.highlightPin || null;

  // Determine pin color class
  let colorClass = "pin-type-" + pin.type.toLowerCase().replace(/\//g, "");
  let customColor = null;

  if (assignment) {
    colorClass = "pin-assigned";
    customColor = peripheralColor(assignment.peripheral);
  }

  if (highlightPeripheral) {
    const hasSignal = pin.signals.some(s => {
      const periph = s.name === "GPIO" ? "" : s.name.split("_")[0];
      return periph === highlightPeripheral;
    });
    if (hasSignal) {
      colorClass = "pin-highlighted";
      customColor = peripheralColor(highlightPeripheral);
    } else if (!assignment) {
      colorClass = "pin-dimmed";
    }
  }

  if (highlightPin && pin.name === highlightPin) {
    colorClass = "pin-selected";
  }

  // Apply to pad/ball element
  const padEl = pinLayout.isBga
    ? group.querySelector(".pin-ball")
    : group.querySelector(".pin-pad");

  if (padEl) {
    padEl.className.baseVal = padEl.className.baseVal.replace(/pin-\S+/g, "").trim();
    padEl.classList.add(pinLayout.isBga ? "pin-ball" : "pin-pad");
    padEl.classList.add(colorClass);
    if (customColor) {
      padEl.style.fill = customColor;
    } else {
      padEl.style.fill = "";
    }
  }

  // Update assignment label
  const assignLabel = group.querySelector(".pin-assignment-label");
  if (assignLabel) {
    if (assignment) {
      assignLabel.textContent = assignment.signalName;
      assignLabel.style.fill = customColor || "";
    } else {
      assignLabel.textContent = "";
      assignLabel.style.fill = "";
    }
  }
}

// ─── Tooltip ────────────────────────────────────────────────────────────

/**
 * Create a tooltip element for showing pin details on hover.
 * @returns {{ el: HTMLElement, show: Function, hide: Function }}
 */
export function createTooltip() {
  const el = document.createElement("div");
  el.className = "pin-tooltip";
  el.style.display = "none";
  document.body.appendChild(el);

  function show(pin, assignment, x, y) {
    let html = `<strong>${pin.name}</strong> (pos: ${pin.position})<br>`;
    html += `<span class="tooltip-type">Type: ${pin.type}</span><br>`;

    if (assignment) {
      html += `<span class="tooltip-assigned">Assigned: ${assignment.signalName}</span><br>`;
    }

    if (pin.signals.length > 0 && pin.type === "I/O") {
      html += `<span class="tooltip-header">Functions:</span>`;
      html += `<ul class="tooltip-signals">`;
      for (const sig of pin.signals) {
        if (sig.name === "GPIO") {
          html += `<li class="tooltip-gpio">GPIO (${(sig.ioModes || []).join(", ")})</li>`;
        } else {
          const cls = assignment && assignment.signalName === sig.name ? "tooltip-active" : "";
          html += `<li class="${cls}">${sig.name}</li>`;
        }
      }
      html += `</ul>`;
    }

    el.innerHTML = html;
    el.style.display = "block";

    // Position near cursor but stay in viewport
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x + 15;
    let top = y + 10;
    if (left + rect.width > vw) left = x - rect.width - 10;
    if (top + rect.height > vh) top = y - rect.height - 10;
    el.style.left = left + "px";
    el.style.top = top + "px";
  }

  function hide() {
    el.style.display = "none";
  }

  return { el, show, hide };
}
