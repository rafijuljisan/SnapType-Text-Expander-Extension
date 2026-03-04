/**
 * SnapType — Toolbar Popup Script
 */

const $ = id => document.getElementById(id);

let snippets = [];
let settings = {};

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const res = await sendMessage({ type: 'GET_ALL' });
  snippets = res.snippets || [];
  settings = res.settings || {};

  renderStats();
  renderSnippetList();
  renderToggle();
}

function renderStats() {
  $('statTotal').textContent = snippets.length;
  $('statKey').textContent   = settings.triggerKey || 'Tab';
  $('quickTriggerDisplay').value = settings.triggerKey || 'Tab';
}

function renderToggle() {
  const enabled = settings.enabled !== false;
  $('enabledToggle').checked = enabled;
  $('toggleLabel').textContent = enabled ? 'ON' : 'OFF';
  document.body.classList.toggle('is-disabled', !enabled);
}

function renderSnippetList() {
  const list = $('snippetList');
  if (snippets.length === 0) {
    list.innerHTML = `<li style="padding:16px; text-align:center; color:var(--muted); font-size:12px;">No snippets yet. Add one above!</li>`;
    return;
  }
  // Show last 6
  const recent = [...snippets].reverse().slice(0, 6);
  list.innerHTML = recent.map(s => `
    <li class="snippet-item">
      <span class="snippet-abbr">${escapeHtml(s.abbr)}</span>
      <span class="snippet-text">${escapeHtml(s.text)}</span>
    </li>
  `).join('');
}

// ─── Save Snippet ─────────────────────────────────────────────────────────────
$('saveBtn').addEventListener('click', async () => {
  const abbr = $('quickAbbr').value.trim();
  const text = $('quickText').value.trim();

  if (!abbr) { showToast('Enter an abbreviation'); return; }
  if (!text)  { showToast('Enter expansion text');  return; }
  if (abbr.includes(' ')) { showToast('No spaces in abbreviations'); return; }

  const res = await sendMessage({ type: 'SAVE_SNIPPET', abbr, text });
  if (res.success) {
    showToast(`✓ Saved! ${snippets.length + 1} total`);
    $('quickAbbr').value = '';
    $('quickText').value = '';
    await init();
  } else {
    showToast('Error saving snippet');
  }
});

$('clearBtn').addEventListener('click', () => {
  $('quickAbbr').value = '';
  $('quickText').value = '';
  $('quickAbbr').focus();
});

// ─── Toggle ───────────────────────────────────────────────────────────────────
$('enabledToggle').addEventListener('change', async (e) => {
  const enabled = e.target.checked;
  $('toggleLabel').textContent = enabled ? 'ON' : 'OFF';
  document.body.classList.toggle('is-disabled', !enabled);
  await sendMessage({ type: 'UPDATE_SETTINGS', patch: { enabled } });
  showToast(enabled ? '▶ SnapType active' : '⏸ SnapType paused');
});

// ─── Open Options ─────────────────────────────────────────────────────────────
$('openOptionsBtn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

// ─── Export ───────────────────────────────────────────────────────────────────
$('exportBtn').addEventListener('click', async () => {
  const res = await sendMessage({ type: 'EXPORT_DATA' });
  if (res.success) {
    downloadJson(res.data, `snaptype-snippets-${datestamp()}.json`);
    showToast('↓ Exported!');
  }
});

// ─── Enter key on abbr → jump to text ─────────────────────────────────────────
$('quickAbbr').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); $('quickText').focus(); }
});
$('quickText').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); $('saveBtn').click(); }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sendMessage(msg) {
  return new Promise(resolve => chrome.runtime.sendMessage(msg, resolve));
}

function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2000);
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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

init();
