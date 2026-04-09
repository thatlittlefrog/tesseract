// browser.js - Browse and search MCU files from STMicro GitHub repository

const REPO = "STMicroelectronics/STM32_open_pin_data";
const API_BASE = `https://api.github.com/repos/${REPO}`;

/** @type {string|null} */
let resolvedBranch = null;

/** @type {string[]|null} */
let mcuListCache = null;

/**
 * Fetch the list of MCU XML filenames from the GitHub repo.
 * Uses the Git Trees API (single request, handles >1000 files).
 * Caches the result after the first call.
 * @returns {Promise<string[]>} Sorted array of filenames like "STM32H743ZITx.xml"
 */
export async function fetchMcuList() {
  if (mcuListCache) return mcuListCache;

  const branches = ["master", "main"];
  let lastError = null;

  for (const branch of branches) {
    try {
      const resp = await fetch(`${API_BASE}/git/trees/${branch}?recursive=1`);

      if (resp.status === 403) {
        const data = await resp.json().catch(() => ({}));
        if (data.message && data.message.includes("rate limit")) {
          throw new Error(
            "GitHub API rate limit exceeded (60/hr unauthenticated). Try again later or drag a local XML file."
          );
        }
        throw new Error(`GitHub API error: ${resp.status}`);
      }

      if (!resp.ok) continue;

      const data = await resp.json();
      resolvedBranch = branch;

      mcuListCache = data.tree
        .filter((item) => item.type === "blob" && /^mcu\/[^/]+\.xml$/.test(item.path))
        .map((item) => item.path.slice(4)) // strip "mcu/" prefix
        .sort();

      return mcuListCache;
    } catch (err) {
      lastError = err;
      // If it's a rate limit error, don't try the next branch
      if (err.message.includes("rate limit")) throw err;
    }
  }

  throw lastError || new Error("Could not fetch MCU list from GitHub.");
}

/**
 * Fetch the raw XML content for a given MCU filename.
 * Uses raw.githubusercontent.com (no API rate limit).
 * @param {string} filename e.g. "STM32H743ZITx.xml"
 * @returns {Promise<string>} XML text
 */
export async function fetchMcuXml(filename) {
  const branch = resolvedBranch || "master";
  const url = `https://raw.githubusercontent.com/${REPO}/${branch}/mcu/${encodeURIComponent(filename)}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch ${filename} (HTTP ${resp.status})`);
  }
  return resp.text();
}

/**
 * Filter MCU list by search query. Matches anywhere in the filename, case-insensitive.
 * @param {string[]} list
 * @param {string} query
 * @returns {string[]}
 */
export function filterMcuList(list, query) {
  if (!query.trim()) return [];
  const q = query.toLowerCase().trim();
  return list.filter((name) => name.toLowerCase().includes(q));
}
