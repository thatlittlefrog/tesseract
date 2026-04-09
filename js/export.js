// export.js - Export pin assignments to various formats

/**
 * Export assignments as JSON.
 * @param {import('./parser.js').McuData} mcuData
 * @param {import('./conflicts.js').AssignmentState} state
 * @returns {string}
 */
export function exportJSON(mcuData, state) {
  const data = {
    mcu: mcuData.refName,
    package: mcuData.package,
    family: mcuData.family,
    exportDate: new Date().toISOString(),
    assignments: state.getAllAssignments().map(a => {
      const pin = mcuData.pins.find(p => p.name === a.pinName);
      return {
        pin: a.pinName,
        position: pin ? pin.position : "",
        signal: a.signalName,
        peripheral: a.peripheral,
      };
    }),
  };
  return JSON.stringify(data, null, 2);
}

/**
 * Export assignments as CSV.
 * @param {import('./parser.js').McuData} mcuData
 * @param {import('./conflicts.js').AssignmentState} state
 * @returns {string}
 */
export function exportCSV(mcuData, state) {
  const lines = ["Pin,Position,Signal,Peripheral"];
  for (const a of state.getAllAssignments()) {
    const pin = mcuData.pins.find(p => p.name === a.pinName);
    const pos = pin ? pin.position : "";
    lines.push(`${a.pinName},${pos},${a.signalName},${a.peripheral}`);
  }
  return lines.join("\n");
}

/**
 * Export assignments as a human-readable text table.
 * @param {import('./parser.js').McuData} mcuData
 * @param {import('./conflicts.js').AssignmentState} state
 * @returns {string}
 */
export function exportText(mcuData, state) {
  const assignments = state.getAllAssignments();
  if (assignments.length === 0) {
    return `${mcuData.refName} (${mcuData.package}) - No pin assignments`;
  }

  // Compute column widths
  let maxPin = 3, maxPos = 3, maxSig = 6, maxPeriph = 10;
  const rows = [];
  for (const a of assignments) {
    const pin = mcuData.pins.find(p => p.name === a.pinName);
    const pos = pin ? pin.position : "";
    rows.push({ pin: a.pinName, pos, sig: a.signalName, periph: a.peripheral });
    maxPin = Math.max(maxPin, a.pinName.length);
    maxPos = Math.max(maxPos, pos.length);
    maxSig = Math.max(maxSig, a.signalName.length);
    maxPeriph = Math.max(maxPeriph, a.peripheral.length);
  }

  const pad = (s, w) => s.padEnd(w);
  const sep = "-".repeat(maxPin + maxPos + maxSig + maxPeriph + 11);

  let out = `${mcuData.refName} (${mcuData.package})\n`;
  out += `${mcuData.core} @ ${mcuData.frequency}MHz | ${mcuData.ram}KB RAM | ${mcuData.flash.join("/")}KB Flash\n`;
  out += `${assignments.length} pin(s) assigned\n\n`;
  out += `${pad("Pin", maxPin)} | ${pad("Pos", maxPos)} | ${pad("Signal", maxSig)} | ${pad("Peripheral", maxPeriph)}\n`;
  out += sep + "\n";

  for (const r of rows) {
    out += `${pad(r.pin, maxPin)} | ${pad(r.pos, maxPos)} | ${pad(r.sig, maxSig)} | ${pad(r.periph, maxPeriph)}\n`;
  }

  return out;
}

/**
 * Export full pinout table (all pins, not just assigned ones).
 * @param {import('./parser.js').McuData} mcuData
 * @param {import('./conflicts.js').AssignmentState} state
 * @returns {string}
 */
export function exportFullPinout(mcuData, state) {
  const lines = ["Pin,Position,Type,Assigned Signal,All Functions"];
  const sorted = [...mcuData.pins].sort((a, b) => {
    // Sort by port letter then number
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });

  for (const pin of sorted) {
    const assignment = state.getAssignment(pin.name);
    const assigned = assignment ? assignment.signalName : "";
    const funcs = pin.signals
      .filter(s => s.name !== "GPIO")
      .map(s => s.name)
      .join(";");
    lines.push(`${pin.name},${pin.position},${pin.type},${assigned},"${funcs}"`);
  }
  return lines.join("\n");
}

/**
 * Trigger a file download in the browser.
 * @param {string} content - File content
 * @param {string} filename - Download filename
 * @param {string} mimeType - MIME type
 */
export function downloadFile(content, filename, mimeType = "text/plain") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
