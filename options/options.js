/**
 * SnapType — Settings Dashboard (options.js)
 * Full CRUD, Import/Export, Settings management
 */

// ─── State ────────────────────────────────────────────────────────────────────
let allSnippets = [];
let filteredSnippets = [];
let currentSettings = {};
let editingAbbr = null;    // null = adding new, string = editing existing
let deleteTargetAbbr = null;
let importMode = 'merge';

// ─── Messaging ────────────────────────────────────────────────────────────────
function send(msg) {
  return new Promise(resolve => chrome.runtime.sendMessage(msg, resolve));
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const res = await send({ type: 'GET_ALL' });
  allSnippets     = res.snippets || [];
  currentSettings = res.settings || {};
  filteredSnippets = [...allSnippets];

  renderSnippetsTable();
  renderSettings();
  updateSidebarStatus();
}

// ─── Navigation ──────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    item.classList.add('active');
    document.getElementById(`page-${item.dataset.page}`).classList.add('active');
  });
});

// ─── Snippets Table ───────────────────────────────────────────────────────────
function renderSnippetsTable() {
  const tbody = document.getElementById('snippetsTbody');
  document.getElementById('snippetCount').textContent = allSnippets.length;

  if (filteredSnippets.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="4"><div class="empty-state">
        <div class="empty-icon">${allSnippets.length === 0 ? '📋' : '🔍'}</div>
        <div class="empty-text">${allSnippets.length === 0 ? 'No snippets yet' : 'No results found'}</div>
        <div class="empty-sub">${allSnippets.length === 0 ? 'Click "+ Add Snippet" to create your first one.' : 'Try a different search term.'}</div>
      </div></td></tr>`;
    return;
  }

  tbody.innerHTML = filteredSnippets.map(s => {
    const date = s.created ? new Date(s.created).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : '—';
    return `
      <tr>
        <td class="td-abbr">${escHtml(s.abbr)}</td>
        <td class="td-text" title="${escHtml(s.text)}">${escHtml(s.text)}</td>
        <td class="td-date">${date}</td>
        <td class="td-actions">
          <button class="icon-btn" title="Edit" data-edit="${escHtml(s.abbr)}">✏</button>
          <button class="icon-btn danger" title="Delete" data-delete="${escHtml(s.abbr)}">🗑</button>
        </td>
      </tr>`;
  }).join('');

  // Bind row buttons
  tbody.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => openEditModal(btn.dataset.edit));
  });
  tbody.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', () => openDeleteModal(btn.dataset.delete));
  });
}

// ─── Search ───────────────────────────────────────────────────────────────────
document.getElementById('searchInput').addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase();
  filteredSnippets = q
    ? allSnippets.filter(s => s.abbr.toLowerCase().includes(q) || s.text.toLowerCase().includes(q))
    : [...allSnippets];
  renderSnippetsTable();
});

// ─── Add / Edit Modal ─────────────────────────────────────────────────────────
document.getElementById('addSnippetBtn').addEventListener('click', () => openAddModal());

function openAddModal() {
  editingAbbr = null;
  document.getElementById('modalTitle').textContent = 'Add Snippet';
  document.getElementById('modalAbbr').value  = '';
  document.getElementById('modalAbbr').readOnly = false;
  document.getElementById('modalText').value  = '';
  document.getElementById('abbrError').style.display = 'none';
  document.getElementById('textError').style.display = 'none';
  openModal('snippetModal');
  setTimeout(() => document.getElementById('modalAbbr').focus(), 100);
}

function openEditModal(abbr) {
  const snippet = allSnippets.find(s => s.abbr === abbr);
  if (!snippet) return;
  editingAbbr = abbr;
  document.getElementById('modalTitle').textContent = 'Edit Snippet';
  document.getElementById('modalAbbr').value  = snippet.abbr;
  document.getElementById('modalAbbr').readOnly = true; // Can't change abbr — delete + re-add
  document.getElementById('modalText').value  = snippet.text;
  document.getElementById('abbrError').style.display = 'none';
  document.getElementById('textError').style.display = 'none';
  openModal('snippetModal');
  setTimeout(() => document.getElementById('modalText').focus(), 100);
}

document.getElementById('modalSave').addEventListener('click', async () => {
  const abbr = document.getElementById('modalAbbr').value.trim();
  const text = document.getElementById('modalText').value.trim();
  let valid  = true;

  const abbrErr = document.getElementById('abbrError');
  const textErr = document.getElementById('textError');
  abbrErr.style.display = 'none';
  textErr.style.display = 'none';

  if (!abbr) {
    abbrErr.textContent = 'Abbreviation cannot be empty.';
    abbrErr.style.display = 'block';
    valid = false;
  } else if (abbr.includes(' ')) {
    abbrErr.textContent = 'Abbreviation cannot contain spaces.';
    abbrErr.style.display = 'block';
    valid = false;
  } else if (!editingAbbr) {
    // Check duplicate only when adding
    const exists = allSnippets.some(s => s.abbr.toLowerCase() === abbr.toLowerCase());
    if (exists) {
      abbrErr.textContent = 'This abbreviation already exists.';
      abbrErr.style.display = 'block';
      valid = false;
    }
  }

  if (!text) {
    textErr.textContent = 'Expansion text cannot be empty.';
    textErr.style.display = 'block';
    valid = false;
  }

  if (!valid) return;

  const res = await send({ type: 'SAVE_SNIPPET', abbr, text });
  if (res.success) {
    closeModal('snippetModal');
    showToast(editingAbbr ? '✓ Snippet updated' : `✓ Snippet saved! ${res.total} total`, 'accent');
    await init();
  } else {
    showToast('Error saving snippet', 'danger');
  }
});

document.getElementById('modalCancel').addEventListener('click', () => closeModal('snippetModal'));

// ─── Delete Modal ─────────────────────────────────────────────────────────────
function openDeleteModal(abbr) {
  deleteTargetAbbr = abbr;
  document.getElementById('deleteTargetAbbr').textContent = abbr;
  openModal('deleteModal');
}

document.getElementById('deleteConfirmBtn').addEventListener('click', async () => {
  if (!deleteTargetAbbr) return;
  const res = await send({ type: 'DELETE_SNIPPET', abbr: deleteTargetAbbr });
  if (res.success) {
    closeModal('deleteModal');
    showToast(`🗑 Deleted "${deleteTargetAbbr}"`, 'danger');
    deleteTargetAbbr = null;
    await init();
  }
});

document.getElementById('deleteCancelBtn').addEventListener('click', () => closeModal('deleteModal'));

// ─── Settings ─────────────────────────────────────────────────────────────────
function renderSettings() {
  document.getElementById('settingEnabled').checked      = currentSettings.enabled      !== false;
  document.getElementById('settingShowPopup').checked    = currentSettings.showPopup    !== false;
  document.getElementById('settingCaseSensitive').checked = currentSettings.caseSensitive === true;
  document.getElementById('settingBadgeCount').checked   = currentSettings.badgeCount   !== false;

  const sel = document.getElementById('settingTriggerKey');
  const key = currentSettings.triggerKey || 'Tab';
  for (const opt of sel.options) { opt.selected = opt.value === key; }
}

async function saveSetting(patch) {
  const res = await send({ type: 'UPDATE_SETTINGS', patch });
  if (res.success) {
    currentSettings = res.settings;
    updateSidebarStatus();
    showToast('✓ Setting saved', 'accent');
  }
}

document.getElementById('settingEnabled').addEventListener('change', e =>
  saveSetting({ enabled: e.target.checked }));
document.getElementById('settingShowPopup').addEventListener('change', e =>
  saveSetting({ showPopup: e.target.checked }));
document.getElementById('settingCaseSensitive').addEventListener('change', e =>
  saveSetting({ caseSensitive: e.target.checked }));
document.getElementById('settingBadgeCount').addEventListener('change', e =>
  saveSetting({ badgeCount: e.target.checked }));
document.getElementById('settingTriggerKey').addEventListener('change', e =>
  saveSetting({ triggerKey: e.target.value }));

document.getElementById('deleteAllBtn').addEventListener('click', async () => {
  if (!confirm(`Delete ALL ${allSnippets.length} snippets? This cannot be undone.`)) return;
  for (const s of allSnippets) {
    await send({ type: 'DELETE_SNIPPET', abbr: s.abbr });
  }
  showToast('All snippets deleted', 'danger');
  await init();
});

function updateSidebarStatus() {
  const enabled = currentSettings.enabled !== false;
  document.getElementById('sidebarDot').className    = `status-dot${enabled ? '' : ' off'}`;
  document.getElementById('sidebarStatus').textContent = enabled ? 'Active' : 'Paused';
}

// ─── Export ───────────────────────────────────────────────────────────────────
document.getElementById('exportAllBtn').addEventListener('click', async () => {
  const res = await send({ type: 'EXPORT_DATA' });
  if (res.success) {
    downloadJson(res.data, `snaptype-${datestamp()}.json`);
    showToast(`↓ Exported ${allSnippets.length} snippets`, 'accent');
  }
});

// ─── Import ───────────────────────────────────────────────────────────────────
// Mode selection
document.querySelectorAll('#importModeGroup .radio-opt').forEach(opt => {
  opt.addEventListener('click', () => {
    document.querySelectorAll('#importModeGroup .radio-opt').forEach(o => o.classList.remove('selected'));
    opt.classList.add('selected');
    importMode = opt.dataset.mode;
  });
});

// Drop zone
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('importFileInput');

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleImportFile(file);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleImportFile(fileInput.files[0]);
  fileInput.value = '';
});

async function handleImportFile(file) {
  if (!file.name.endsWith('.json')) {
    showImportResult(false, 'Please select a .json file.');
    return;
  }
  const text = await file.text();
  const res  = await send({ type: 'IMPORT_DATA', data: text, mode: importMode });
  const result = document.getElementById('importResult');

  if (res.success) {
    showImportResult(true, `✓ Imported ${res.imported} snippets. Total: ${res.total}.`);
    showToast(`✓ ${res.imported} snippets imported`, 'accent');
    await init();
  } else {
    showImportResult(false, `✗ ${res.error}`);
  }
}

function showImportResult(success, msg) {
  const el = document.getElementById('importResult');
  el.textContent = msg;
  el.className   = `import-result ${success ? 'success' : 'error'}`;
}

// ─── Modal Helpers ────────────────────────────────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.add('open');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

// Close on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('open');
  });
});

// ESC key to close
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
  }
});

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg, type = '') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('show'));
  });
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function downloadJson(data, filename) {
  const blob = new Blob([data], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function datestamp() {
  return new Date().toISOString().slice(0, 10);
}

// ─── Start ────────────────────────────────────────────────────────────────────
init();
