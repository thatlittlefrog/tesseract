// parser.js - Parse STM32_open_pin_data XML into a clean data model

/**
 * @typedef {Object} Signal
 * @property {string} name - Signal name (e.g. "USART1_TX", "ADC1_IN0", "GPIO")
 * @property {string[]} [ioModes] - Only present on GPIO signal: ["Input","Output","Analog","EXTI","EVENTOUT"]
 */

/**
 * @typedef {Object} Pin
 * @property {string} name - Pin name (e.g. "PA0", "VDD", "NRST")
 * @property {string} position - Physical position: integer string for QFP, grid coord for BGA (e.g. "A1")
 * @property {string} type - "I/O" | "Power" | "Reset" | "Boot" | "MonoIO"
 * @property {Signal[]} signals - Available functions for this pin
 */

/**
 * @typedef {Object} McuData
 * @property {string} refName - Full part number (e.g. "STM32H743ZITx")
 * @property {string} family - Product family (e.g. "STM32H7")
 * @property {string} line - Product line (e.g. "STM32H743/753")
 * @property {string} package - Package type (e.g. "LQFP144")
 * @property {string} core - CPU core (e.g. "Arm Cortex-M7")
 * @property {number} frequency - Max frequency in MHz
 * @property {number} ram - RAM in KB
 * @property {number[]} flash - Flash sizes in KB (may have multiple variants)
 * @property {string} die - Die identifier
 * @property {{min: number, max: number}} voltage - Operating voltage range
 * @property {{min: number, max: number}} temperature - Operating temperature range
 * @property {number} ioCount - Number of I/O pins
 * @property {Pin[]} pins - All pins
 * @property {Object<string, string[]>} peripherals - Grouped by peripheral prefix
 * @property {string} packageType - Derived: "QFP" | "BGA" | "DIP" | "SOP"
 * @property {number} pinCount - Total pin count from package string
 */

/**
 * Parse an STM32 MCU XML string into a McuData object.
 * @param {string} xmlString - Raw XML content from STM32_open_pin_data
 * @returns {McuData}
 */
export function parseMcuXml(xmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, "application/xml");

  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error("XML parse error: " + parseError.textContent);
  }

  const mcu = doc.querySelector("Mcu");
  if (!mcu) {
    throw new Error("No <Mcu> element found in XML");
  }

  // Parse root attributes
  const refName = mcu.getAttribute("RefName") || "";
  const family = mcu.getAttribute("Family") || "";
  const line = mcu.getAttribute("Line") || "";
  const packageStr = mcu.getAttribute("Package") || "";
  const hasPowerPad = mcu.getAttribute("HasPowerPad") === "true";

  // Parse metadata elements
  const core = getTextContent(mcu, "Core");
  const frequency = getNumberContent(mcu, "Frequency");
  const ram = getNumberContent(mcu, "Ram");
  const die = getTextContent(mcu, "Die");
  const ioCount = getNumberContent(mcu, "IONb");

  // Flash can have multiple entries (variants)
  const flashEls = mcu.querySelectorAll("Flash");
  const flash = Array.from(flashEls).map(el => parseInt(el.textContent, 10)).filter(n => !isNaN(n));

  // Voltage range
  const voltageEl = mcu.querySelector("Voltage");
  const voltage = voltageEl
    ? { min: parseFloat(voltageEl.getAttribute("Min")) || 0, max: parseFloat(voltageEl.getAttribute("Max")) || 0 }
    : { min: 0, max: 0 };

  // Temperature range
  const tempEl = mcu.querySelector("Temperature");
  const temperature = tempEl
    ? { min: parseFloat(tempEl.getAttribute("Min")) || 0, max: parseFloat(tempEl.getAttribute("Max")) || 0 }
    : { min: 0, max: 0 };

  // Parse all pins
  const pinEls = mcu.querySelectorAll("Pin");
  const pins = Array.from(pinEls).map(pinEl => parsePin(pinEl));

  // Derive peripheral grouping from signal names
  const peripherals = derivePeripherals(pins);

  // Derive package type info
  const { packageType, pinCount } = parsePackageInfo(packageStr);

  return {
    refName,
    family,
    line,
    package: packageStr,
    core,
    frequency,
    ram,
    flash,
    die,
    voltage,
    temperature,
    ioCount,
    hasPowerPad,
    pins,
    peripherals,
    packageType,
    pinCount,
  };
}

/**
 * Parse a single <Pin> element.
 * @param {Element} pinEl
 * @returns {Pin}
 */
function parsePin(pinEl) {
  const name = pinEl.getAttribute("Name") || "";
  const position = pinEl.getAttribute("Position") || "";
  const type = pinEl.getAttribute("Type") || "";

  const signalEls = pinEl.querySelectorAll("Signal");
  const signals = Array.from(signalEls).map(sigEl => {
    const sig = { name: sigEl.getAttribute("Name") || "" };
    const ioModes = sigEl.getAttribute("IOModes");
    if (ioModes) {
      sig.ioModes = ioModes.split(",").map(s => s.trim());
    }
    return sig;
  });

  return { name, position, type, signals };
}

/**
 * Group signals by peripheral prefix.
 * E.g. "USART1_TX" → peripheral "USART1", "SPI2_MISO" → "SPI2"
 * Skips GPIO, system signals (SYS_*, RCC_*), and signals without underscore.
 */
function derivePeripherals(pins) {
  const peripherals = {};

  for (const pin of pins) {
    for (const signal of pin.signals) {
      if (signal.name === "GPIO") continue;

      const underscoreIdx = signal.name.indexOf("_");
      if (underscoreIdx === -1) continue;

      const prefix = signal.name.substring(0, underscoreIdx);
      // Skip pure system prefixes that aren't useful as "peripherals"
      if (prefix === "SYS" || prefix === "DEBUG") continue;

      if (!peripherals[prefix]) {
        peripherals[prefix] = new Set();
      }
      peripherals[prefix].add(signal.name);
    }
  }

  // Convert sets to sorted arrays
  const result = {};
  for (const [key, value] of Object.entries(peripherals).sort((a, b) => a[0].localeCompare(b[0]))) {
    result[key] = Array.from(value).sort();
  }
  return result;
}

/**
 * Derive package type and pin count from the Package string.
 * E.g. "LQFP144" → { packageType: "QFP", pinCount: 144 }
 *      "VFBGA264" → { packageType: "BGA", pinCount: 264 }
 *      "TSSOP20" → { packageType: "SOP", pinCount: 20 }
 */
function parsePackageInfo(packageStr) {
  const upper = packageStr.toUpperCase();

  let packageType = "QFP"; // default
  if (upper.includes("BGA") || upper.includes("WLCSP")) {
    packageType = "BGA";
  } else if (upper.includes("TSSOP") || upper.includes("SOP") || upper.match(/^SO\d/)) {
    packageType = "SOP";
  } else if (upper.includes("DIP")) {
    packageType = "DIP";
  }
  // QFP covers: LQFP, UFQFPN, QFN, QFP, EQFP, WQFN, etc.

  // Extract pin count from trailing digits
  const match = packageStr.match(/(\d+)$/);
  const pinCount = match ? parseInt(match[1], 10) : 0;

  return { packageType, pinCount };
}

// Helpers

function getTextContent(parent, tagName) {
  const el = parent.querySelector(tagName);
  return el ? el.textContent.trim() : "";
}

function getNumberContent(parent, tagName) {
  const el = parent.querySelector(tagName);
  return el ? parseInt(el.textContent, 10) || 0 : 0;
}
