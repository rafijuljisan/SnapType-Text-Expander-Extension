/**
 * SnapType — Content Script
 * Fixes: Facebook double-injection
 * New:   Auto-suggest popup while typing (no trigger key needed)
 */

// ─── State ────────────────────────────────────────────────────────────────────
let snippets = [];
let settings = {
  enabled:       true,
  triggerKey:    'Tab',
  caseSensitive: false,
  showPopup:     true,
};

// ─── Load ─────────────────────────────────────────────────────────────────────
function loadState(cb) {
  chrome.runtime.sendMessage({ type: 'GET_ALL' }, (res) => {
    if (chrome.runtime.lastError) return;
    if (res && res.success) {
      snippets = res.snippets || [];
      settings = { ...settings, ...(res.settings || {}) };
    }
    if (cb) cb();
  });
}
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SNIPPETS_UPDATED' || msg.type === 'SETTINGS_UPDATED') loadState();
});
loadState();

// ─── Element helpers ──────────────────────────────────────────────────────────
function isSupportedElement(el) {
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'textarea' || tag === 'input') return true;
  if (el.isContentEditable || el.contentEditable === 'true') return true;
  let p = el.parentElement;
  while (p) {
    if (p.isContentEditable || p.contentEditable === 'true') return true;
    p = p.parentElement;
  }
  return false;
}

function isInputOrTextarea(el) {
  return ['input','textarea'].includes((el.tagName || '').toLowerCase());
}

function getCERoot(el) {
  if (!el) return null;
  if (el.isContentEditable || el.contentEditable === 'true') return el;
  let p = el.parentElement;
  while (p) {
    if (p.isContentEditable || p.contentEditable === 'true') return p;
    p = p.parentElement;
  }
  return null;
}

// ─── Get word before cursor ───────────────────────────────────────────────────
function getWordBeforeCursor(el) {
  if (isInputOrTextarea(el)) {
    const val    = el.value || '';
    const caret  = el.selectionStart != null ? el.selectionStart : val.length;
    const before = val.slice(0, caret);
    const m = before.match(/(\S+)$/);
    return m ? m[1] : '';
  }
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return '';
  try {
    const range = sel.getRangeAt(0).cloneRange();
    const root  = getCERoot(el) || document.body;
    const pre   = document.createRange();
    pre.selectNodeContents(root);
    pre.setEnd(range.endContainer, range.endOffset);
    const text = pre.toString();
    const m = text.match(/(\S+)$/);
    return m ? m[1] : '';
  } catch { return ''; }
}

// ─── Find matches (prefix match for auto-suggest, exact for trigger) ──────────
function findExactMatches(word) {
  if (!word) return [];
  const w = settings.caseSensitive ? word : word.toLowerCase();
  return snippets.filter(s => {
    const a = settings.caseSensitive ? s.abbr : s.abbr.toLowerCase();
    return a === w;
  });
}

function findPrefixMatches(word) {
  if (!word || word.length < 1) return [];
  const w = settings.caseSensitive ? word : word.toLowerCase();
  return snippets.filter(s => {
    const a = settings.caseSensitive ? s.abbr : s.abbr.toLowerCase();
    return a.startsWith(w) || a === w;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  INJECTION — Facebook-safe single-shot approach
//
//  The Facebook double-insert bug happened because:
//   1. We called sel.modify('extend','backward') to re-select the abbr
//   2. Then execCommand / DOM manipulation BOTH fired
//   3. Facebook's React handler also fired on the selection change
//
//  Fix: For contenteditable, we use ONE method only — clipboard paste with
//  precise selection. We never mix execCommand + DOM manipulation.
//  We use a mutex flag to ensure injection only fires once per expansion.
// ═══════════════════════════════════════════════════════════════════════════════
let injecting = false; // mutex — prevent double-fire

async function injectText(el, abbr, expansion) {
  if (injecting) return;
  injecting = true;
  try {
    if (isInputOrTextarea(el)) {
      injectIntoInput(el, abbr, expansion);
    } else {
      await injectIntoCE(el, abbr, expansion);
    }
  } finally {
    // Release mutex after a tick so any re-entrant calls are blocked
    setTimeout(() => { injecting = false; }, 100);
  }
}

// ── input / textarea ──────────────────────────────────────────────────────────
function injectIntoInput(el, abbr, expansion) {
  el.focus();
  const val       = el.value || '';
  const end       = el.selectionStart != null ? el.selectionStart : val.length;
  const start     = end - abbr.length;
  if (start < 0) return;

  const inputType     = (el.type || 'text').toLowerCase();
  const isSpecialType = ['email','url','number','tel','search'].includes(inputType);

  if (isSpecialType) {
    // Chrome blocks execCommand('insertText') on email/url/number inputs.
    // setRangeText() is the correct API — works on all input types.
    try {
      el.setRangeText(expansion, start, end, 'end');
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    } catch {}
    // Final fallback: native value setter
    const before = val.slice(0, start);
    const after  = val.slice(end);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(el, before + expansion + after);
    else el.value = before + expansion + after;
    try { el.setSelectionRange(start + expansion.length, start + expansion.length); } catch {}
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  // Standard text / textarea — try execCommand first (preserves undo history)
  el.setSelectionRange(start, end);
  let ok = false;
  try { ok = document.execCommand('insertText', false, expansion); } catch {}

  if (!ok) {
    const before = val.slice(0, start);
    const after  = val.slice(end);
    const proto  = el.tagName.toLowerCase() === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, before + expansion + after);
    else el.value = before + expansion + after;
    el.setSelectionRange(start + expansion.length, start + expansion.length);
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

// ── contenteditable (Facebook, Gmail, Notion, Twitter…) ──────────────────────
async function injectIntoCE(el, abbr, expansion) {
  const root = getCERoot(el) || el;
  root.focus();

  // Step 1: Precisely select ONLY the abbreviation text before cursor
  const selected = selectAbbrBeforeCursor(abbr);
  if (!selected) return;

  // Step 2: Single injection method — clipboard paste
  // This is the ONLY method that works reliably on Facebook without double-insert
  // because it replaces the selection atomically.
  try {
    const prev = await safeReadClipboard();
    await navigator.clipboard.writeText(expansion);

    // Use execCommand paste — replaces selection in one atomic op
    document.execCommand('paste');

    // Restore clipboard
    if (prev !== null) setTimeout(() => navigator.clipboard.writeText(prev).catch(() => {}), 300);
    return;
  } catch {}

  // Fallback if clipboard API blocked: manual range replacement
  // (This path does NOT use sel.modify which caused the double-insert)
  try {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(expansion);
    range.insertNode(node);
    const nr = document.createRange();
    nr.setStartAfter(node);
    nr.collapse(true);
    sel.removeAllRanges();
    sel.addRange(nr);
    root.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: expansion }));
  } catch {}
}

// Select exactly `abbr.length` characters before the cursor using Range API
// Returns true if selection was made successfully
function selectAbbrBeforeCursor(abbr) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;

  try {
    const range     = sel.getRangeAt(0).cloneRange();
    const cursorNode   = range.startContainer;
    const cursorOffset = range.startOffset;

    // Build a new range that starts `abbr.length` chars before cursor
    const newRange = document.createRange();
    let   remaining = abbr.length;
    let   node      = cursorNode;
    let   offset    = cursorOffset;

    // Walk backwards through text nodes
    while (remaining > 0 && node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text      = node.textContent || '';
        const available = Math.min(offset, remaining);
        if (available > 0) {
          remaining -= available;
          offset    -= available;
          if (remaining === 0) {
            newRange.setStart(node, offset);
          }
        }
        if (remaining > 0) {
          // Move to previous sibling or parent
          node   = prevTextNode(node);
          offset = node ? (node.textContent || '').length : 0;
        }
      } else {
        node   = prevTextNode(node);
        offset = node ? (node.textContent || '').length : 0;
      }
    }

    if (remaining > 0) {
      // Couldn't walk back far enough — fall back to sel.modify
      sel.modify('extend', 'backward', 'character');
      for (let i = 1; i < abbr.length; i++) sel.modify('extend', 'backward', 'character');
      return true;
    }

    newRange.setEnd(cursorNode, cursorOffset);
    sel.removeAllRanges();
    sel.addRange(newRange);
    return true;
  } catch {
    // Last resort: sel.modify
    try {
      for (let i = 0; i < abbr.length; i++) sel.modify('extend', 'backward', 'character');
      return true;
    } catch { return false; }
  }
}

function prevTextNode(node) {
  // Walk DOM backwards to find previous text node
  let cur = node;
  while (cur) {
    if (cur.previousSibling) {
      cur = cur.previousSibling;
      while (cur.lastChild) cur = cur.lastChild;
      if (cur.nodeType === Node.TEXT_NODE) return cur;
    } else {
      cur = cur.parentNode;
      if (!cur || cur === document.body) return null;
    }
  }
  return null;
}

async function safeReadClipboard() {
  try { return await navigator.clipboard.readText(); } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LISTENERS
//  Two modes:
//   A) Auto-suggest: popup appears while typing when word matches a prefix
//   B) Trigger key:  popup appears (or instant expand) when trigger key pressed
// ═══════════════════════════════════════════════════════════════════════════════

// Debounce timer for auto-suggest
let autoSuggestTimer = null;

document.addEventListener('keydown', handleKeydown, true);
document.addEventListener('input',   handleInput,   true);

function handleKeydown(e) {
  if (!settings.enabled) return;
  if (e.target?.closest?.('[data-snaptype]')) return;

  const el = document.activeElement;
  if (!isSupportedElement(el)) return;

  // If popup open, handle navigation
  if (popupEl) {
    if (e.key === 'ArrowDown')  { e.preventDefault(); e.stopPropagation(); movePopup(1); return; }
    if (e.key === 'ArrowUp')    { e.preventDefault(); e.stopPropagation(); movePopup(-1); return; }
    if (e.key === 'Enter')      { e.preventDefault(); e.stopPropagation(); confirmExpansion(); return; }
    if (e.key === 'Escape')     { e.preventDefault(); e.stopPropagation(); closePopup(); return; }
    if (e.key === 'Tab') {
      // Tab confirms if popup open
      e.preventDefault(); e.stopPropagation();
      confirmExpansion();
      return;
    }
    // Any other key — close popup, let typing continue (auto-suggest will re-open if needed)
    if (e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Alt' && e.key !== 'Meta') {
      closePopup();
    }
    return;
  }

  // Check trigger key (only if popup not already open)
  const tk = settings.triggerKey || 'Tab';
  const isTrigger =
    (tk === 'Tab'   && e.key === 'Tab')   ||
    (tk === ' '     && e.key === ' ')     ||
    (tk === 'Enter' && e.key === 'Enter');

  if (isTrigger) {
    const word = getWordBeforeCursor(el);
    const matches = findExactMatches(word);
    if (matches.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      if (settings.showPopup !== false) {
        showPopup(el, word, matches, false);
      } else {
        injectText(el, word, matches[0].text);
        showToast('⚡ Expanded!');
      }
    }
  }
}

function handleInput(e) {
  if (!settings.enabled) return;
  if (e.target?.closest?.('[data-snaptype]')) return;

  const el = document.activeElement;
  if (!isSupportedElement(el)) return;

  // Auto-suggest: debounced, fires after short pause while typing
  clearTimeout(autoSuggestTimer);
  autoSuggestTimer = setTimeout(() => {
    const word = getWordBeforeCursor(el);
    if (!word || word.length < 1) { closePopup(); return; }

    const matches = findPrefixMatches(word);
    if (matches.length === 0) { closePopup(); return; }

    // Show popup with prefix matches — mark exact matches specially
    showPopup(el, word, matches, true /* isAutoSuggest */);
  }, 120); // 120ms debounce — feels instant but doesn't flicker on fast typing
}

// ─── Popup ────────────────────────────────────────────────────────────────────
let popupEl        = null;
let popupMatches   = [];
let popupIndex     = 0;
let popupAbbr      = '';
let popupTarget    = null;
let popupIsAutoSuggest = false;

function showPopup(targetEl, typedWord, matches, isAutoSuggest) {
  // If same matches already showing, just update highlight
  if (popupEl && popupAbbr === typedWord) {
    popupMatches = matches;
    popupIsAutoSuggest = isAutoSuggest;
    if (popupIndex >= matches.length) popupIndex = 0;
    refreshPopupRows(typedWord, matches);
    return;
  }

  closePopup(true);
  popupMatches       = matches;
  popupIndex         = 0;
  popupAbbr          = typedWord;
  popupTarget        = targetEl;
  popupIsAutoSuggest = isAutoSuggest;

  const rect   = targetEl.getBoundingClientRect();
  const scrollX = window.scrollX || window.pageXOffset;
  const scrollY = window.scrollY || window.pageYOffset;
  let top  = rect.bottom + scrollY + 6;
  let left = rect.left   + scrollX;
  if (left + 300 > window.innerWidth + scrollX) left = window.innerWidth + scrollX - 310;
  if (left < scrollX + 8) left = scrollX + 8;

  const popup = document.createElement('div');
  popup.id = 'snaptype-popup';
  popup.setAttribute('data-snaptype', 'true');
  popup.style.cssText = `all:initial !important; position:absolute !important; top:${top}px !important; left:${left}px !important; z-index:2147483647 !important; pointer-events:none !important; font-family:'DM Mono','Courier New',monospace !important;`;

  const card = document.createElement('div');
  card.id = 'snaptype-card';
  card.style.cssText = 'background:#0f1318 !important; border:1px solid #1e2530 !important; border-radius:10px !important; box-shadow:0 8px 40px rgba(0,0,0,0.8),0 0 0 1px rgba(0,229,160,0.12) !important; overflow:hidden !important; min-width:220px !important; max-width:380px !important; pointer-events:none !important;';

  // Header
  const hdr = document.createElement('div');
  hdr.id = 'snaptype-hdr';
  hdr.style.cssText = 'padding:7px 14px 5px !important; border-bottom:1px solid #1e2530 !important; display:flex !important; align-items:center !important; gap:8px !important;';
  card.appendChild(hdr);

  // Rows container
  const rowsWrap = document.createElement('div');
  rowsWrap.id = 'snaptype-rows';
  card.appendChild(rowsWrap);

  // Footer
  const ftr = document.createElement('div');
  ftr.style.cssText = 'padding:5px 14px !important; border-top:1px solid #1e2530 !important; display:flex !important; gap:14px !important; justify-content:flex-end !important;';
  ftr.innerHTML = `<span style="all:initial;font-family:inherit !important;font-size:10px !important;color:#2a3a4a !important;">↑↓ select</span><span style="all:initial;font-family:inherit !important;font-size:10px !important;color:#2a3a4a !important;">↵ / Tab expand</span><span style="all:initial;font-family:inherit !important;font-size:10px !important;color:#2a3a4a !important;">Esc close</span>`;
  card.appendChild(ftr);

  popup.appendChild(card);
  document.body.appendChild(popup);
  popupEl = popup;

  refreshPopupRows(typedWord, matches);
}

function refreshPopupRows(typedWord, matches) {
  const hdr = document.getElementById('snaptype-hdr');
  const rowsWrap = document.getElementById('snaptype-rows');
  if (!hdr || !rowsWrap) return;

  // Header
  hdr.innerHTML = `
    <span style="all:initial;font-family:inherit !important;font-size:10px !important;color:#3a4a5a !important;text-transform:uppercase !important;letter-spacing:1px !important;">SnapType</span>
    <span style="all:initial;font-family:inherit !important;font-size:12px !important;color:#00e5a0 !important;font-weight:600 !important;background:rgba(0,229,160,0.1) !important;padding:1px 8px !important;border-radius:4px !important;">${escHtml(typedWord)}</span>
    <span style="all:initial;font-family:inherit !important;font-size:10px !important;color:#3a4a5a !important;margin-left:auto !important;">${matches.length} match${matches.length !== 1 ? 'es' : ''}</span>
  `;

  // Rows
  rowsWrap.innerHTML = '';
  matches.slice(0, 6).forEach((m, i) => {
    rowsWrap.appendChild(buildRow(m, i === popupIndex, i, typedWord));
  });
}

function buildRow(snippet, active, idx, typedWord) {
  const row = document.createElement('div');
  row.setAttribute('data-snaptype-idx', String(idx));
  row.style.cssText = `display:flex !important; align-items:center !important; gap:10px !important; padding:8px 14px !important; background:${active ? 'rgba(0,229,160,0.07)' : 'transparent'} !important; border-left:2px solid ${active ? '#00e5a0' : 'transparent'} !important; overflow:hidden !important; pointer-events:none !important;`;

  // Abbreviation — highlight the typed prefix
  const a = document.createElement('span');
  a.style.cssText = `all:initial !important; font-family:inherit !important; font-size:12px !important; font-weight:600 !important; flex-shrink:0 !important; display:inline-flex !important; align-items:center !important; gap:0 !important;`;

  const abbr = snippet.abbr;
  const matchLen = typedWord.length;
  const typed = abbr.slice(0, matchLen);
  const rest  = abbr.slice(matchLen);

  // Typed part — fully lit
  const typedSpan = document.createElement('span');
  typedSpan.style.cssText = `all:initial !important; font-family:inherit !important; font-size:12px !important; font-weight:700 !important; color:${active ? '#0d0f12' : '#00e5a0'} !important; background:${active ? '#00e5a0' : 'rgba(0,229,160,0.15)'} !important; padding:1px 0 1px 7px !important; border-radius:${rest ? '4px 0 0 4px' : '4px'} !important;`;
  typedSpan.textContent = typed;

  a.appendChild(typedSpan);

  if (rest) {
    // Remaining part — dimmer
    const restSpan = document.createElement('span');
    restSpan.style.cssText = `all:initial !important; font-family:inherit !important; font-size:12px !important; font-weight:600 !important; color:${active ? '#0d0f12' : '#4a8a6a'} !important; background:${active ? '#00e5a0' : 'rgba(0,229,160,0.06)'} !important; padding:1px 7px 1px 0 !important; border-radius:0 4px 4px 0 !important;`;
    restSpan.textContent = rest;
    a.appendChild(restSpan);
  }

  const t = document.createElement('span');
  t.style.cssText = `all:initial !important; font-family:inherit !important; font-size:12px !important; color:${active ? '#dde4ed' : '#5a6a7e'} !important; white-space:nowrap !important; overflow:hidden !important; text-overflow:ellipsis !important; flex:1 !important; display:block !important;`;
  t.textContent = snippet.text;

  row.appendChild(a);
  row.appendChild(t);
  return row;
}

function movePopup(dir) {
  popupIndex = (popupIndex + dir + popupMatches.length) % popupMatches.length;
  refreshPopupRows(popupAbbr, popupMatches);
}

function confirmExpansion() {
  if (!popupTarget || !popupMatches.length) return;
  const chosen = popupMatches[popupIndex];
  const target = popupTarget;
  const abbr   = popupAbbr;
  closePopup(true);
  clearTimeout(autoSuggestTimer);

  // Use exact abbr that was typed (popupAbbr = what user typed so far)
  setTimeout(() => {
    injectText(target, abbr, chosen.text);
    showToast('⚡ Expanded!');
  }, 20);
}

function closePopup(silent = false) {
  if (popupEl) { popupEl.remove(); popupEl = null; }
  popupMatches = []; popupIndex = 0; popupAbbr = ''; popupTarget = null; popupIsAutoSuggest = false;
  if (!silent) clearTimeout(autoSuggestTimer);
}

document.addEventListener('mousedown', (e) => {
  if (popupEl && !e.target.closest?.('#snaptype-popup')) closePopup();
}, true);

// Close popup when focus leaves a field
document.addEventListener('focusout', () => {
  setTimeout(() => {
    if (popupEl) closePopup();
  }, 150);
}, true);

// ─── Toast ────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  let t = document.getElementById('snaptype-toast');
  if (!t) { t = document.createElement('div'); t.id = 'snaptype-toast'; t.setAttribute('data-snaptype','true'); document.body.appendChild(t); }
  t.setAttribute('style','all:initial !important;position:fixed !important;bottom:24px !important;right:24px !important;z-index:2147483647 !important;background:#00e5a0 !important;color:#0d0f12 !important;font-family:"DM Mono",monospace !important;font-size:13px !important;font-weight:600 !important;padding:9px 18px !important;border-radius:24px !important;box-shadow:0 4px 20px rgba(0,229,160,0.25) !important;pointer-events:none !important;transition:opacity 0.2s,transform 0.2s !important;opacity:0 !important;transform:translateY(6px) !important;');
  t.textContent = msg;
  requestAnimationFrame(() => requestAnimationFrame(() => { t.style.setProperty('opacity','1','important'); t.style.setProperty('transform','translateY(0)','important'); }));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.setProperty('opacity','0','important'); t.style.setProperty('transform','translateY(6px)','important'); }, 1800);
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

console.log('[SnapType] Ready. Auto-suggest active.');
