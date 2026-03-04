/**
 * SnapType — Background Service Worker
 * Phase 1 & 2: Storage Layer + Message Routing
 *
 * Responsibilities:
 *  - Initialize storage with default snippets on first install
 *  - Handle all CRUD operations for snippets
 *  - Route messages between popup, options page, and content scripts
 *  - Manage global enabled/disabled state
 *  - Handle keyboard shortcut command toggle
 */

// ─── Constants ───────────────────────────────────────────────────────────────
const STORAGE_KEY_SNIPPETS  = 'snaptype_snippets';
const STORAGE_KEY_SETTINGS  = 'snaptype_settings';
const STORAGE_KEY_VERSION   = 'snaptype_version';
const CURRENT_VERSION       = '1.0.0';

// ─── Default Settings ─────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  enabled:         true,      // global on/off
  triggerKey:      'Tab',     // key that fires expansion (Tab or Space)
  caseSensitive:   false,     // whether abbreviation matching is case-sensitive
  showPopup:       true,      // show suggestion popup vs instant replace
  badgeCount:      true,      // show snippet count on toolbar icon
};

// ─── Default Snippets ─────────────────────────────────────────────────────────
const DEFAULT_SNIPPETS = [
  { abbr: 'myemail',  text: 'nixsoletechd@gmail.com',             created: new Date().toISOString() },
  { abbr: 'myaddr',   text: '123 Main Street, Dhaka, Bangladesh', created: new Date().toISOString() },
  { abbr: 'myphone',  text: '+880-1234-567890',                   created: new Date().toISOString() },
  { abbr: 'tysm',     text: 'Thank you so much!',                 created: new Date().toISOString() },
  { abbr: 'brb',      text: 'Be right back.',                     created: new Date().toISOString() },
];

// ─── Install Handler ──────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    console.log('[SnapType] First install — seeding defaults');
    await chrome.storage.sync.set({
      [STORAGE_KEY_SNIPPETS]: DEFAULT_SNIPPETS,
      [STORAGE_KEY_SETTINGS]: DEFAULT_SETTINGS,
      [STORAGE_KEY_VERSION]:  CURRENT_VERSION,
    });
    updateBadge(DEFAULT_SNIPPETS.length, DEFAULT_SETTINGS.enabled);
  } else if (details.reason === 'update') {
    console.log('[SnapType] Updated to', CURRENT_VERSION);
    // future: run migrations here
  }
});

// ─── Startup Handler ─────────────────────────────────────────────────────────
chrome.runtime.onStartup.addListener(async () => {
  const settings  = await getSettings();
  const snippets  = await getSnippets();
  updateBadge(snippets.length, settings.enabled);
});

// ─── Storage API ─────────────────────────────────────────────────────────────

async function getSnippets() {
  const result = await chrome.storage.sync.get(STORAGE_KEY_SNIPPETS);
  return result[STORAGE_KEY_SNIPPETS] || [];
}

async function getSettings() {
  const result = await chrome.storage.sync.get(STORAGE_KEY_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEY_SETTINGS] || {}) };
}

async function saveSnippet(abbr, text) {
  const snippets = await getSnippets();
  const settings = await getSettings();

  const existing = snippets.findIndex(s =>
    settings.caseSensitive ? s.abbr === abbr : s.abbr.toLowerCase() === abbr.toLowerCase()
  );

  const entry = {
    abbr:    abbr.trim(),
    text:    text,
    created: existing >= 0 ? snippets[existing].created : new Date().toISOString(),
    updated: new Date().toISOString(),
  };

  if (existing >= 0) {
    snippets[existing] = entry;
  } else {
    snippets.push(entry);
  }

  await chrome.storage.sync.set({ [STORAGE_KEY_SNIPPETS]: snippets });
  updateBadge(snippets.length, (await getSettings()).enabled);
  notifyContentScripts({ type: 'SNIPPETS_UPDATED' });
  return { success: true, snippet: entry, total: snippets.length };
}

async function deleteSnippet(abbr) {
  const snippets = await getSnippets();
  const filtered = snippets.filter(s => s.abbr !== abbr);
  await chrome.storage.sync.set({ [STORAGE_KEY_SNIPPETS]: filtered });
  updateBadge(filtered.length, (await getSettings()).enabled);
  notifyContentScripts({ type: 'SNIPPETS_UPDATED' });
  return { success: true, total: filtered.length };
}

async function updateSettings(patch) {
  const current = await getSettings();
  const updated = { ...current, ...patch };
  await chrome.storage.sync.set({ [STORAGE_KEY_SETTINGS]: updated });
  const snippets = await getSnippets();
  updateBadge(snippets.length, updated.enabled);
  notifyContentScripts({ type: 'SETTINGS_UPDATED', settings: updated });
  return updated;
}

// Export all data as a JSON blob string
async function exportData() {
  const snippets = await getSnippets();
  const settings = await getSettings();
  return JSON.stringify({
    version:     CURRENT_VERSION,
    exported_at: new Date().toISOString(),
    settings,
    snippets,
  }, null, 2);
}

// Import from JSON blob string — mode: 'merge' | 'replace'
async function importData(jsonString, mode = 'merge') {
  let parsed;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    return { success: false, error: 'Invalid JSON format' };
  }

  if (!parsed.snippets || !Array.isArray(parsed.snippets)) {
    return { success: false, error: 'No valid snippets array found' };
  }

  // Validate each snippet
  const incoming = parsed.snippets.filter(s =>
    s && typeof s.abbr === 'string' && typeof s.text === 'string' &&
    s.abbr.trim().length > 0 && s.text.trim().length > 0
  ).map(s => ({
    abbr:    s.abbr.trim(),
    text:    s.text,
    created: s.created || new Date().toISOString(),
    updated: new Date().toISOString(),
  }));

  if (incoming.length === 0) {
    return { success: false, error: 'No valid snippets found in import file' };
  }

  let finalSnippets;
  if (mode === 'replace') {
    finalSnippets = incoming;
  } else {
    // Merge: incoming wins on conflict
    const current = await getSnippets();
    const map = new Map(current.map(s => [s.abbr.toLowerCase(), s]));
    incoming.forEach(s => map.set(s.abbr.toLowerCase(), s));
    finalSnippets = Array.from(map.values());
  }

  await chrome.storage.sync.set({ [STORAGE_KEY_SNIPPETS]: finalSnippets });
  updateBadge(finalSnippets.length, (await getSettings()).enabled);
  notifyContentScripts({ type: 'SNIPPETS_UPDATED' });

  return { success: true, imported: incoming.length, total: finalSnippets.length };
}

// ─── Badge Helper ─────────────────────────────────────────────────────────────
function updateBadge(count, enabled) {
  if (!enabled) {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#6b7280' });
  } else if (count > 0) {
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// ─── Notify All Tabs ─────────────────────────────────────────────────────────
async function notifyContentScripts(message) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id) {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {
        // Tab may not have content script — ignore
      });
    }
  }
}

// ─── Keyboard Shortcut Command ────────────────────────────────────────────────
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-extension') {
    const settings = await getSettings();
    const updated  = await updateSettings({ enabled: !settings.enabled });
    console.log('[SnapType] Toggled:', updated.enabled ? 'ON' : 'OFF');
  }
});

// ─── Message Router ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(err => {
    sendResponse({ success: false, error: err.message });
  });
  return true; // Keep channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.type) {

    case 'GET_SNIPPETS':
      return { success: true, snippets: await getSnippets() };

    case 'GET_SETTINGS':
      return { success: true, settings: await getSettings() };

    case 'SAVE_SNIPPET':
      return await saveSnippet(message.abbr, message.text);

    case 'DELETE_SNIPPET':
      return await deleteSnippet(message.abbr);

    case 'UPDATE_SETTINGS':
      return { success: true, settings: await updateSettings(message.patch) };

    case 'EXPORT_DATA':
      return { success: true, data: await exportData() };

    case 'IMPORT_DATA':
      return await importData(message.data, message.mode || 'merge');

    case 'GET_ALL': {
      const [snippets, settings] = await Promise.all([getSnippets(), getSettings()]);
      return { success: true, snippets, settings };
    }

    default:
      return { success: false, error: `Unknown message type: ${message.type}` };
  }
}
