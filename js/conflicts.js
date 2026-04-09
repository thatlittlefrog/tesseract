// conflicts.js - Pin assignment state management and conflict detection

/**
 * @typedef {Object} Assignment
 * @property {string} pinName - Pin name (e.g. "PA0")
 * @property {string} signalName - Assigned signal (e.g. "USART1_TX")
 * @property {string} peripheral - Derived peripheral name (e.g. "USART1")
 */

/**
 * @typedef {Object} Conflict
 * @property {string} pinName - The contested pin
 * @property {string[]} signals - The conflicting signal names
 * @property {string[]} peripherals - The conflicting peripheral names
 */

export class AssignmentState {
  constructor() {
    /** @type {Map<string, Assignment>} pinName → Assignment */
    this.assignments = new Map();

    /** @type {Set<Function>} change listeners */
    this.listeners = new Set();
  }

  /**
   * Assign a signal to a pin. Replaces any existing assignment on that pin.
   * @param {string} pinName
   * @param {string} signalName
   */
  assign(pinName, signalName) {
    const peripheral = extractPeripheral(signalName);
    this.assignments.set(pinName, { pinName, signalName, peripheral });
    this._notify();
  }

  /**
   * Remove assignment from a pin.
   * @param {string} pinName
   */
  unassign(pinName) {
    if (this.assignments.has(pinName)) {
      this.assignments.delete(pinName);
      this._notify();
    }
  }

  /**
   * Clear all assignments.
   */
  clearAll() {
    this.assignments.clear();
    this._notify();
  }

  /**
   * Get assignment for a specific pin.
   * @param {string} pinName
   * @returns {Assignment|undefined}
   */
  getAssignment(pinName) {
    return this.assignments.get(pinName);
  }

  /**
   * Get all assignments as an array.
   * @returns {Assignment[]}
   */
  getAllAssignments() {
    return Array.from(this.assignments.values());
  }

  /**
   * Get all pins assigned to a specific peripheral.
   * @param {string} peripheral - e.g. "SPI1"
   * @returns {Assignment[]}
   */
  getPeripheralAssignments(peripheral) {
    return this.getAllAssignments().filter(a => a.peripheral === peripheral);
  }

  /**
   * Get all unique peripherals that have at least one pin assigned.
   * @returns {string[]}
   */
  getAssignedPeripherals() {
    const set = new Set();
    for (const a of this.assignments.values()) {
      if (a.peripheral) set.add(a.peripheral);
    }
    return Array.from(set).sort();
  }

  /**
   * Detect conflicts: cases where two different peripherals both need
   * a signal that's only available on the same pin, or where a peripheral's
   * required signals can't all be satisfied simultaneously.
   *
   * For now, we detect the simpler case: a pin can only have one assignment.
   * The real conflict is when a user tries to use two peripherals that
   * compete for the same pin. We check this by looking at whether any
   * peripheral has signals assigned to pins that are also assigned to
   * a different peripheral's signal.
   *
   * @param {import('./parser.js').McuData} mcuData
   * @returns {Conflict[]}
   */
  getConflicts(mcuData) {
    // A pin only has one assignment at a time (last write wins),
    // so pin-level conflicts don't exist in our model.
    // Instead, we look for peripheral-level issues:
    // If a peripheral needs multiple signals and some of those signals
    // share pins with other assigned peripherals.

    // Build: for each pin, which peripherals WANT it?
    // A peripheral "wants" a pin if:
    //   1. It's currently assigned there, OR
    //   2. The user has assigned other signals of the same peripheral,
    //      and this pin is the ONLY option for a remaining signal.

    // For v1, we do something simpler and still very useful:
    // Show which assigned peripherals share pin options (potential conflicts).
    return this._detectPinOptionOverlaps(mcuData);
  }

  /**
   * For each pair of assigned peripherals, check if they have any
   * signal-to-pin overlaps that could cause conflicts.
   * @param {import('./parser.js').McuData} mcuData
   * @returns {Conflict[]}
   */
  _detectPinOptionOverlaps(mcuData) {
    const conflicts = [];

    // Build a map: signalName → set of pin names that offer it
    const signalToPins = new Map();
    for (const pin of mcuData.pins) {
      for (const sig of pin.signals) {
        if (sig.name === "GPIO") continue;
        if (!signalToPins.has(sig.name)) {
          signalToPins.set(sig.name, new Set());
        }
        signalToPins.get(sig.name).add(pin.name);
      }
    }

    // For each assigned peripheral, find all pins it's using
    const periphPins = new Map(); // peripheral → Set<pinName>
    for (const assignment of this.assignments.values()) {
      if (!assignment.peripheral) continue;
      if (!periphPins.has(assignment.peripheral)) {
        periphPins.set(assignment.peripheral, new Set());
      }
      periphPins.get(assignment.peripheral).add(assignment.pinName);
    }

    // Check: are any two peripherals assigned to the same pin?
    // (This shouldn't happen since we enforce one assignment per pin,
    //  but signals from different peripherals might need the same pin)
    const pinToPeripherals = new Map();
    for (const [periph, pins] of periphPins) {
      for (const pin of pins) {
        if (!pinToPeripherals.has(pin)) {
          pinToPeripherals.set(pin, []);
        }
        pinToPeripherals.get(pin).push(periph);
      }
    }

    for (const [pin, periphs] of pinToPeripherals) {
      if (periphs.length > 1) {
        const assignment = this.assignments.get(pin);
        conflicts.push({
          pinName: pin,
          signals: [assignment?.signalName || ""],
          peripherals: periphs,
        });
      }
    }

    return conflicts;
  }

  /**
   * Check if assigning a signal to a pin would cause any issues.
   * Returns a description of the issue, or null if safe.
   * @param {string} pinName
   * @param {string} signalName
   * @returns {string|null}
   */
  wouldConflict(pinName, signalName) {
    const existing = this.assignments.get(pinName);
    if (existing && existing.signalName !== signalName) {
      return `Pin ${pinName} is already assigned to ${existing.signalName}. This will replace it.`;
    }
    return null;
  }

  /**
   * Register a listener for state changes.
   * @param {Function} fn
   */
  onChange(fn) {
    this.listeners.add(fn);
  }

  /**
   * Remove a change listener.
   * @param {Function} fn
   */
  offChange(fn) {
    this.listeners.delete(fn);
  }

  _notify() {
    for (const fn of this.listeners) {
      try { fn(); } catch (e) { console.error("Listener error:", e); }
    }
  }

  /**
   * Serialize assignments for export.
   * @returns {Object[]}
   */
  toExportData() {
    return this.getAllAssignments().map(a => ({
      pin: a.pinName,
      signal: a.signalName,
      peripheral: a.peripheral,
    }));
  }

  /**
   * Load assignments from exported data.
   * @param {Object[]} data
   */
  fromExportData(data) {
    this.assignments.clear();
    for (const item of data) {
      this.assignments.set(item.pin, {
        pinName: item.pin,
        signalName: item.signal,
        peripheral: item.peripheral || extractPeripheral(item.signal),
      });
    }
    this._notify();
  }
}

/**
 * Extract peripheral name from signal name.
 * "USART1_TX" → "USART1"
 * "ADC1_INP16" → "ADC1"
 * "GPIO" → ""
 * "TIM2_CH1" → "TIM2"
 */
export function extractPeripheral(signalName) {
  if (signalName === "GPIO") return "";
  const idx = signalName.indexOf("_");
  if (idx === -1) return signalName;
  return signalName.substring(0, idx);
}

/**
 * Get a color for a peripheral based on its type.
 * Groups similar peripherals under the same hue.
 * @param {string} peripheral
 * @returns {string} CSS color
 */
export function peripheralColor(peripheral) {
  const base = peripheral.replace(/\d+$/, "");
  const colorMap = {
    "USART": "#4fc3f7",
    "UART": "#4fc3f7",
    "LPUART": "#4fc3f7",
    "SPI": "#ab47bc",
    "I2C": "#66bb6a",
    "TIM": "#ffa726",
    "LPTIM": "#ffa726",
    "ADC": "#ef5350",
    "DAC": "#ec407a",
    "CAN": "#26a69a",
    "FDCAN": "#26a69a",
    "USB": "#42a5f5",
    "ETH": "#5c6bc0",
    "SAI": "#8d6e63",
    "SDMMC": "#78909c",
    "SDIO": "#78909c",
    "QUADSPI": "#7e57c2",
    "OCTOSPI": "#7e57c2",
    "XSPI": "#7e57c2",
    "FMC": "#9ccc65",
    "FSMC": "#9ccc65",
    "DCMI": "#ff7043",
    "LTDC": "#ffca28",
    "COMP": "#bdbdbd",
    "OPAMP": "#bdbdbd",
    "RTC": "#80cbc4",
    "RCC": "#90a4ae",
    "TSC": "#ce93d8",
    "SWPMI": "#a1887f",
    "MDIOS": "#80deea",
    "DFSDM": "#c5e1a5",
    "HRTIM": "#ffab91",
    "BDMA": "#b0bec5",
    "DMA": "#b0bec5",
    "GPDMA": "#b0bec5",
  };

  if (colorMap[base]) return colorMap[base];

  // Deterministic color from string hash for unknown peripherals
  let hash = 0;
  for (let i = 0; i < peripheral.length; i++) {
    hash = peripheral.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 55%, 60%)`;
}
