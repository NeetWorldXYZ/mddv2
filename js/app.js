/* Basic configuration */
const CONFIG = {
  goalUsd: 1_000_000,
  dataUrl: '/api/donors',
  // If you have a Stripe Payment Link, paste it here to enable real payments:
  stripePaymentLink: '', // e.g. 'https://buy.stripe.com/xxxxx'
  // If true and stripePaymentLink is empty, the Donate button opens a demo modal
  enableDemoDonations: true
};

const MESSAGE_MAX_CHARS = 140;

// Determine API base for local vs production. You can override by setting window.__API_BASE__ before app.js loads.
const API_BASE = (() => {
  if (typeof window !== 'undefined' && window.__API_BASE__) return window.__API_BASE__;
  const host = (typeof window !== 'undefined' && window.location && window.location.hostname) || '';
  if (host.includes('localhost') || host.startsWith('127.')) return 'http://localhost:8787';
  // Default production API domain (point this CNAME to your backend host)
  return 'https://api.milliondollardummy.com';
})();
// Simple denylist for racist/offensive words (lowercase). Extend as needed.
// Notes: We normalize input heavily before checking, to catch obfuscations.
const BANNED_WORDS = [
  'nigger','nigga','chink','spic','wetback','kike','fag','faggot','tranny','retard','retarded',
  'coon','gook','porchmonkey','jigaboo','zipperhead','raghead','sandnigger','towelhead',
  'whitepower','white supremacy','heilhitler','siegheil','gas the jews','kill all jews',
  'lynch','monkey person','go back to','great replacement',
  'fuck','motherfucker','cunt'
];
function normalizeForFilter(input) {
  const map = { '0':'o','1':'i','!':'i','3':'e','4':'a','@':'a','$':'s','5':'s','7':'t','+':'t' };
  let s = (input || '').toLowerCase();
  s = s.replace(/[0-9!3@4$57+]/g, (m) => map[m] || '');
  s = s.replace(/[\W_]+/g, ' ');
  const noSpace = s.replace(/\s+/g, '');
  return { spaced: ` ${s.trim()} `, nospace: noSpace };
}
function containsBanned(input) {
  if (!input) return false;
  const { spaced, nospace } = normalizeForFilter(input);
  for (const term of BANNED_WORDS) {
    const t = term.toLowerCase();
    if (spaced.includes(` ${t} `) || nospace.includes(t.replace(/\s+/g,''))) return true;
  }
  return false;
}
const currencyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const dateFmt = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: '2-digit' });

let donors = [];
let initialAnimationDone = false;
const WALL_PREVIEW_COUNT = 6;
const WALL_PAGE_CHUNK = 30;
let visibleCount = Infinity;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sumUsd(items) {
  return items.reduce((acc, d) => acc + (Number(d.amountUsd) || 0), 0);
}

function formatPercent(n) {
  if (n > 0 && n < 1) return '<1%';
  return `${Math.round(n)}%`;
}

function setProgress(totalUsd) {
  const percent = clamp((totalUsd / CONFIG.goalUsd) * 100, 0, 100);
  const fill = document.getElementById('progressFill');
  const percentEl = document.getElementById('progressPercent');
  const raisedEl = document.getElementById('raisedAmount');
  const donorCountEl = document.getElementById('donorCount');
  const goalEl = document.getElementById('goalAmount');

  if (fill) {
    const widthPercent = percent > 0 && percent < 1 ? 1 : percent;
    fill.style.width = `${widthPercent}%`;
  }
  if (percentEl) {
    const ratioText = `${currencyFmt.format(totalUsd)} / ${currencyFmt.format(CONFIG.goalUsd)}`;
    percentEl.textContent = ratioText;
  }
  if (raisedEl) raisedEl.textContent = currencyFmt.format(totalUsd);
  if (donorCountEl) donorCountEl.textContent = String(donors.length);
  if (goalEl) goalEl.textContent = currencyFmt.format(CONFIG.goalUsd);

  const progressBar = document.querySelector('.progress-bar');
  if (progressBar) {
    const ariaNow = percent > 0 && percent < 1 ? 1 : Math.round(percent);
    progressBar.setAttribute('aria-valuenow', String(ariaNow));
  }
}

function animateValue({ start, end, durationMs, onUpdate, onComplete }) {
  const startTs = performance.now();
  const delta = end - start;
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  function frame(now) {
    const elapsed = now - startTs;
    const t = clamp(elapsed / durationMs, 0, 1);
    const eased = easeOutCubic(t);
    const value = start + delta * eased;
    onUpdate(value, t);
    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      if (onComplete) onComplete();
    }
  }
  requestAnimationFrame(frame);
}

function animateInitialProgress(totalUsd) {
  if (initialAnimationDone) {
    setProgress(totalUsd);
    return;
  }
  const fill = document.getElementById('progressFill');
  const percentEl = document.getElementById('progressPercent');
  const raisedEl = document.getElementById('raisedAmount');
  const donorCountEl = document.getElementById('donorCount');
  const goalEl = document.getElementById('goalAmount');

  const percentTarget = clamp((totalUsd / CONFIG.goalUsd) * 100, 0, 100);
  const donorCountTarget = donors.length;

  if (goalEl) goalEl.textContent = currencyFmt.format(CONFIG.goalUsd);

  // If nothing to animate, set and exit
  if (!fill || totalUsd <= 0 || percentTarget <= 0 || donorCountTarget <= 0) {
    setProgress(totalUsd);
    initialAnimationDone = true;
    return;
  }

  // Reset UI to zero state
  fill.style.transition = 'none';
  fill.style.width = '0%';
  if (percentEl) percentEl.textContent = `${currencyFmt.format(0)} / ${currencyFmt.format(CONFIG.goalUsd)}`;
  if (raisedEl) raisedEl.textContent = currencyFmt.format(0);
  if (donorCountEl) donorCountEl.textContent = '0';

  // Force reflow, then enable transition and animate width
  void fill.offsetWidth; // reflow
  fill.style.transition = ''; // use CSS-defined transition
  // Kick off width animation on next frame
  requestAnimationFrame(() => {
    const widthTarget = percentTarget > 0 && percentTarget < 1 ? 1 : percentTarget;
    fill.style.width = `${widthTarget}%`;
  });

  // Animate numbers
  animateValue({
    start: 0,
    end: totalUsd,
    durationMs: 900,
    onUpdate: (v) => {
      if (raisedEl) raisedEl.textContent = currencyFmt.format(Math.round(v));
      if (percentEl) percentEl.textContent = `${currencyFmt.format(Math.round(v))} / ${currencyFmt.format(CONFIG.goalUsd)}`;
    }
  });
  animateValue({
    start: 0,
    end: donorCountTarget,
    durationMs: 700,
    onUpdate: (v) => {
      if (donorCountEl) donorCountEl.textContent = String(Math.round(v));
    },
    onComplete: () => {
      initialAnimationDone = true;
      setProgress(totalUsd); // snap to exact final values and update aria
    }
  });
}

function renderWall() {
  const grid = document.getElementById('wallGrid');
  const topGrid = document.getElementById('topGrid');
  const empty = document.getElementById('emptyState');
  if (!grid) return;
  grid.setAttribute('aria-busy', 'true');
  grid.innerHTML = '';
  if (topGrid) { topGrid.setAttribute('aria-busy', 'true'); topGrid.innerHTML = ''; }

  if (!donors.length) {
    if (empty) empty.hidden = false;
    grid.setAttribute('aria-busy', 'false');
    if (topGrid) topGrid.setAttribute('aria-busy', 'false');
    return;
  }
  if (empty) empty.hidden = true;

  // Compute top 3 by amount (always for top section)
  let topThree = [];
  const compareAmountDescDateAsc = (a, b) => {
    const aAmt = Number(a.amountUsd || 0);
    const bAmt = Number(b.amountUsd || 0);
    if (bAmt !== aAmt) return bAmt - aAmt; // amount desc
    const aTs = a.date ? new Date(a.date).getTime() : 0;
    const bTs = b.date ? new Date(b.date).getTime() : 0;
    return aTs - bTs; // earlier date first
  };
  const byAmount = donors.slice().sort(compareAmountDescDateAsc);
  topThree = byAmount.slice(0, Math.min(3, byAmount.length));
  const topKeys = new Set(topThree.map(d => `${d.name}|${d.amountUsd}|${d.date}`));

  // Render top grid if present
  if (topGrid) {
    const topFrag = document.createDocumentFragment();
    const rankLabels = ['1st', '2nd', '3rd'];
    topThree.forEach((d, i) => {
      const card = document.createElement('article');
      card.className = 'card card-rank ' + (i === 0 ? 'card-gold' : i === 1 ? 'card-silver' : 'card-bronze');
      card.style.setProperty('--stagger', `${Math.min(i, 18) * 40}ms`);
      const name = document.createElement('div');
      name.className = 'name';
      const avatar = buildAvatar(d.name || 'Anonymous Dummy');
      if (avatar) name.appendChild(avatar);
      const nameText = document.createElement('span');
      nameText.textContent = d.name || 'Anonymous Dummy';
      name.appendChild(nameText);
      const badge = document.createElement('span');
      const rankClass = i === 0 ? 'badge-gold' : i === 1 ? 'badge-silver' : 'badge-bronze';
      badge.className = `badge-rank ${rankClass}`;
      badge.textContent = rankLabels[i];
      name.appendChild(badge);
      const meta = document.createElement('div');
      meta.className = 'meta';
      const amount = currencyFmt.format(Number(d.amountUsd || 0));
      const dt = d.date ? new Date(d.date) : new Date();
      const amountEl = document.createElement('span');
      amountEl.className = 'amount';
      amountEl.textContent = amount;
      const dateEl = document.createElement('span');
      dateEl.className = 'date';
      dateEl.textContent = dateFmt.format(dt);
      meta.appendChild(amountEl);
      meta.appendChild(document.createTextNode(' • '));
      meta.appendChild(dateEl);
      const msg = document.createElement('div');
      msg.className = 'message';
      msg.textContent = (d.message || '').trim();
      card.appendChild(name);
      card.appendChild(meta);
      const socials = buildSocialLinks(d);
      if (socials) card.appendChild(socials);
      if ((d.message || '').trim().length) card.appendChild(msg);
      topFrag.appendChild(card);
    });
    topGrid.appendChild(topFrag);
    topGrid.setAttribute('aria-busy', 'false');
  }

  const fragment = document.createDocumentFragment();
  // Determine which slice to show
  const mode = grid.getAttribute('data-mode') || 'all';
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  let items;
  if (mode === 'preview') {
    const previewCount = Number(grid.dataset.count || WALL_PREVIEW_COUNT);
    const sortMode = (grid.dataset.sort || 'date').toLowerCase();
    let list = donors.slice();
    if (sortMode === 'amount') {
      list.sort(compareAmountDescDateAsc);
    } else {
      list.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    }
    items = list.slice(0, previewCount);
  } else {
    // For the full wall, exclude the top three regardless of sort
    const sortSelect = document.getElementById('sortSelect');
    const currentSort = (sortSelect?.value || 'amount').toLowerCase();
    let list = donors.slice();
    if (currentSort === 'amount') {
      list.sort((a, b) => Number(b.amountUsd || 0) - Number(a.amountUsd || 0));
    } else if (currentSort === 'alpha') {
      list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else {
      list.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    }
    list = list.filter(d => !topKeys.has(`${d.name}|${d.amountUsd}|${d.date}`));
    const count = loadMoreBtn ? Math.min(visibleCount, list.length) : list.length;
    items = list.slice(0, count);
    if (loadMoreBtn) loadMoreBtn.hidden = count >= list.length;
  }

  // Add rank badges for top 3 when in preview mode
  const rankLabels = ['1st', '2nd', '3rd'];
  // Determine whether to highlight top 3 based on current sorting
  let highlightTopThree = false;
  if (mode === 'preview') {
    const sortMode = (grid.dataset.sort || 'date').toLowerCase();
    highlightTopThree = sortMode === 'amount';
  } else {
    const currentSort = (document.getElementById('sortSelect')?.value || 'newest').toLowerCase();
    highlightTopThree = currentSort === 'amount';
  }

  items.forEach((d, i) => {
    const card = document.createElement('article');
    card.className = 'card';
    card.style.setProperty('--stagger', `${Math.min(i, 18) * 40}ms`);
    const name = document.createElement('div');
    name.className = 'name';
    // Avatar with initials
    const avatar = buildAvatar(d.name || 'Anonymous Dummy');
    if (avatar) name.appendChild(avatar);
    const nameText = document.createElement('span');
    nameText.textContent = d.name || 'Anonymous Dummy';
    name.appendChild(nameText);
    if (highlightTopThree && i < 3 && mode === 'preview') {
      // add rank border class
      const rankBorder = i === 0 ? 'card-gold' : i === 1 ? 'card-silver' : 'card-bronze';
      card.classList.add('card-rank', rankBorder);
      const badge = document.createElement('span');
      const rankClass = i === 0 ? 'badge-gold' : i === 1 ? 'badge-silver' : 'badge-bronze';
      badge.className = `badge-rank ${rankClass}`;
      badge.textContent = rankLabels[i];
      name.appendChild(badge);
    }
    const meta = document.createElement('div');
    meta.className = 'meta';
    const amount = currencyFmt.format(Number(d.amountUsd || 0));
    const dt = d.date ? new Date(d.date) : new Date();
    const amountEl = document.createElement('span');
    amountEl.className = 'amount';
    amountEl.textContent = amount;
    const dateEl = document.createElement('span');
    dateEl.className = 'date';
    dateEl.textContent = dateFmt.format(dt);
    meta.appendChild(amountEl);
    meta.appendChild(document.createTextNode(' • '));
    meta.appendChild(dateEl);
    const msg = document.createElement('div');
    msg.className = 'message';
    msg.textContent = (d.message || '').trim();

    card.appendChild(name);
    card.appendChild(meta);
    // Social icons row
    const socials = buildSocialLinks(d);
    if (socials) card.appendChild(socials);
    if ((d.message || '').trim().length) {
      card.appendChild(msg);
    }
    fragment.appendChild(card);
  });

  grid.appendChild(fragment);
  grid.setAttribute('aria-busy', 'false');
}

function buildAvatar(name) {
  const initials = (name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(s => s[0]?.toUpperCase() || '')
    .join('') || 'D';
  const el = document.createElement('span');
  el.className = 'avatar';
  // Color from name hash
  const hue = hashStringToHue(name || 'dummy');
  el.style.background = `linear-gradient(180deg, hsl(${hue} 80% 75%), hsl(${hue} 80% 55%))`;
  el.textContent = initials;
  return el;
}
function hashStringToHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return 20 + (h % 320); // avoid pure reds near 0 for readability
}

function buildSocialLinks(donor) {
  const links = [];
  const map = [
    ['social_x', 'x', (h) => normalizeHandle(h, 'x')],
    ['social_tiktok', 'tiktok', (h) => normalizeHandle(h, 'tiktok')],
    ['social_instagram', 'instagram', (h) => normalizeHandle(h, 'instagram')],
    ['social_youtube', 'youtube', (h) => normalizeHandle(h, 'youtube')],
    ['social_twitch', 'twitch', (h) => normalizeHandle(h, 'twitch')]
  ];
  for (const [key, kind, norm] of map) {
    const raw = donor[key];
    if (typeof raw === 'string' && raw.trim()) {
      const href = norm(raw.trim());
      if (href) links.push([href, kind]);
    }
  }
  if (!links.length) return null;
  const row = document.createElement('div');
  row.className = 'social-links';
  for (const [href, kind] of links) {
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'nofollow noopener noreferrer';
    a.title = kind;
    a.className = `soc soc-${kind}`;
    a.innerHTML = socialIcon(kind);
    row.appendChild(a);
  }
  return row;
}

function normalizeHandle(input, kind) {
  const v = input.trim();
  if (!v) return '';
  const stripAt = v.startsWith('@') ? v.slice(1) : v;
  try {
    const u = new URL(v, 'https://dummy.local');
    const href = v.startsWith('http') ? new URL(v) : null;
    if (href) return href.href;
  } catch {}
  switch (kind) {
    case 'x': return `https://x.com/${stripAt}`;
    case 'tiktok': return `https://www.tiktok.com/@${stripAt}`;
    case 'instagram': return `https://instagram.com/${stripAt}`;
    case 'youtube': return `https://youtube.com/@${stripAt}`;
    case 'twitch': return `https://twitch.tv/${stripAt}`;
    default: return '';
  }
}

function socialIcon(kind) {
  const common = 'width="16" height="16" viewBox="0 0 24 24"';
  if (kind === 'x') {
    return `<svg ${common} fill="currentColor"><path d="M18.2 2h3.1l-6.8 7.8 8 10.2H17l-5-6.6-5.7 6.6H3.2l7.3-8.4L2.9 2h7l4.6 6 3.7-6z"/></svg>`;
  }
  if (kind === 'tiktok') {
    return `<svg ${common} fill="currentColor"><path d="M16.5 2a6 6 0 0 0 4 1.5v3A8.6 8.6 0 0 1 17 5.7v6.1a6.8 6.8 0 1 1-6.8-6.8c.3 0 .6 0 .9.1v3.3c-.3-.1-.6-.1-.9-.1a3.5 3.5 0 1 0 3.5 3.5V2h2.8z"/></svg>`;
  }
  if (kind === 'instagram') {
    return `<svg ${common} fill="currentColor"><path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm5 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm6.5-.8a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z"/></svg>`;
  }
  if (kind === 'youtube') {
    return `<svg ${common} fill="currentColor"><path d="M23 8.5a4 4 0 0 0-2.8-2.9C18.1 5 12 5 12 5s-6.1 0-8.2.6A4 4 0 0 0 1 8.5 41 41 0 0 0 1 12a41 41 0 0 0 1 3.5 4 4 0 0 0 2.8 2.9C5.9 19 12 19 12 19s6.1 0 8.2-.6A4 4 0 0 0 23 15.5 41 41 0 0 0 24 12a41 41 0 0 0-1-3.5zM10 15V9l5 3-5 3z"/></svg>`;
  }
  if (kind === 'twitch') {
    return `<svg ${common} fill="currentColor"><path d="M3 2h18v11l-5 5h-4l-3 3H7v-3H3V2zm16 10V4H5v10h4v3l3-3h4l3-2zM14 6h2v5h-2V6zm-5 0h2v5H9V6z"/></svg>`;
  }
  return '';
}
function sortDonors(mode) {
  if (mode === 'amount') {
    donors.sort((a, b) => Number(b.amountUsd || 0) - Number(a.amountUsd || 0));
  } else if (mode === 'alpha') {
    donors.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  } else {
    donors.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  }
}

async function loadDonors() {
  try {
    let res = await fetch(`${API_BASE}/api/donors`, { cache: 'no-store' });
    if (!res.ok) {
      res = await fetch('/data/donors.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load donors: ${res.status}`);
    }
    const data = await res.json();
    donors = Array.isArray(data) ? data : (Array.isArray(data.donors) ? data.donors : []);
    sortDonors('amount');
    const total = sumUsd(donors);
    animateInitialProgress(total);
    renderWall();
  } catch (err) {
    console.error(err);
    donors = [];
    setProgress(0);
    renderWall();
  }
}

function wireInteractions() {
  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

  // Mark body as ready for entrance animations
  document.body.classList.add('ready');

  // Setup load-more if present (full wall page)
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  if (loadMoreBtn) {
    visibleCount = WALL_PAGE_CHUNK;
    loadMoreBtn.addEventListener('click', () => {
      visibleCount += WALL_PAGE_CHUNK;
      renderWall();
    });
  }

  // Dialog close controls and backdrop click-to-close
  const dialog = document.getElementById('donateDialog');
  if (dialog) {
    // Ensure "Other" input starts hidden on first load
    const initOther = dialog.querySelector('#amountOther');
    if (initOther) initOther.hidden = true;

    // Message maxlength and counter
    const messageEl = dialog.querySelector('#donorMessage');
    const countEl = dialog.querySelector('#messageCount');
    const maxEl = dialog.querySelector('#messageMax');
    if (messageEl) {
      try { messageEl.setAttribute('maxlength', String(MESSAGE_MAX_CHARS)); } catch {}
      const updateCount = () => {
        if (countEl) countEl.textContent = String(messageEl.value.length);
        if (maxEl) maxEl.textContent = String(MESSAGE_MAX_CHARS);
      };
      messageEl.addEventListener('input', updateCount);
      updateCount();
    }

    // Amount preset buttons
    const amountInput = dialog.querySelector('#donationAmount');
    const amountButtons = dialog.querySelectorAll('.amount-btn[data-amount]');
    const otherBtn = dialog.querySelector('.amount-btn-other');
    const amountOtherContainer = dialog.querySelector('#amountOther');
    const clearSelections = () => amountButtons.forEach(b => b.classList.remove('selected'));
    const digitsOnly = (s) => (s || '').replace(/[^\d]/g, '');
    const setFormattedAmount = (num) => {
      if (!amountInput) return;
      if (!num || Number.isNaN(num) || num <= 0) {
        amountInput.value = '';
      } else {
        amountInput.value = currencyFmt.format(Math.round(num));
      }
    };
    amountButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const raw = btn.dataset.amount || '';
        if (raw === 'other') {
          if (amountOtherContainer) amountOtherContainer.hidden = false;
          clearSelections();
          btn.classList.add('selected');
          if (amountInput) {
            amountInput.value = '';
            amountInput.focus();
          }
          return;
        }
        const val = Number(raw || 0);
        setFormattedAmount(val);
        if (amountOtherContainer) amountOtherContainer.hidden = true;
        clearSelections();
        btn.classList.add('selected');
      });
    });
    if (amountInput) {
      amountInput.addEventListener('input', () => {
        // Keep "Other" selected when typing; do not auto-select presets
        if (otherBtn && !otherBtn.classList.contains('selected')) {
          clearSelections();
          otherBtn.classList.add('selected');
        }
        const num = Number(digitsOnly(amountInput.value));
        setFormattedAmount(num);
      });
      amountInput.addEventListener('blur', () => {
        const num = Number(digitsOnly(amountInput.value));
        setFormattedAmount(num);
      });
    }

    // Buttons marked to close without validation
    const closeButtons = dialog.querySelectorAll('[data-close]');
    closeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        if ('close' in dialog) dialog.close();
      });
    });
    // Click on backdrop closes dialog
    dialog.addEventListener('click', (e) => {
      const content = dialog.querySelector('.dialog-content');
      if (!content) return;
      const rect = content.getBoundingClientRect();
      const clickInside =
        e.clientX >= rect.left && e.clientX <= rect.right &&
        e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (!clickInside && 'close' in dialog) {
        dialog.close();
      }
    });
    // Ensure Esc closes even if form has required fields
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      if ('close' in dialog) dialog.close();
    });
  }

  const sortSelect = document.getElementById('sortSelect');
  if (sortSelect) {
    // Default to amount on load
    try { sortSelect.value = 'amount'; } catch {}
    sortDonors('amount');
    sortSelect.addEventListener('change', () => {
      sortDonors(sortSelect.value);
      renderWall();
    });
    // Re-render to apply potential highlight state
    renderWall();
  }

  const donateButtons = [document.getElementById('donateTop'), document.getElementById('donateHero')].filter(Boolean);
  donateButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const dlg = document.getElementById('donateDialog');
      if (dlg && 'showModal' in dlg) {
        // Reset donation modal state before opening
        try {
          const amountInput = dlg.querySelector('#donationAmount');
          const otherBtn = dlg.querySelector('.amount-btn-other');
          const amountButtons = dlg.querySelectorAll('.amount-btn[data-amount]');
          const amountOther = dlg.querySelector('#amountOther');
          const msgEl = dlg.querySelector('#donorMessage');
          const msgCount = dlg.querySelector('#messageCount');
          amountButtons.forEach(b => b.classList.remove('selected'));
          if (amountOther) amountOther.hidden = true;
          if (amountInput) amountInput.value = '';
          if (otherBtn) otherBtn.classList.remove('selected');
          if (msgEl) msgEl.value = '';
          if (msgCount) msgCount.textContent = '0';
        } catch {}
        dlg.showModal();
      }
    });
  });

  // Donation flow (server checkout preferred; demo fallback)
  const donateForm = document.getElementById('donateForm');
  if (donateForm) {
    donateForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const err = document.getElementById('donateError');
      if (err) { err.hidden = true; err.textContent = ''; }
      const name = document.getElementById('donorName')?.value?.trim();
      const rawAmount = document.getElementById('donationAmount')?.value || '';
      const amount = Number(String(rawAmount).replace(/[^\d]/g, ''));
      const messageRaw = document.getElementById('donorMessage')?.value || '';
      const message = String(messageRaw).slice(0, MESSAGE_MAX_CHARS);
      const socialX = document.getElementById('socialX')?.value?.trim() || '';
      const socialTiktok = document.getElementById('socialTiktok')?.value?.trim() || '';
      const socialInstagram = document.getElementById('socialInstagram')?.value?.trim() || '';
      const socialYoutube = document.getElementById('socialYoutube')?.value?.trim() || '';
      const socialTwitch = document.getElementById('socialTwitch')?.value?.trim() || '';
      if (!name) {
        if (err) { err.textContent = 'Please enter your name.'; err.hidden = false; }
        return;
      }
      if (containsBanned(name) || containsBanned(message)) {
        if (err) { err.textContent = 'Please remove offensive language from your name or message.'; err.hidden = false; }
        return;
      }
      if (Number.isNaN(amount) || amount < 1) {
        if (err) { err.textContent = 'Please choose or enter an amount of at least $1.'; err.hidden = false; }
        return;
      }
      startCheckout({
        name,
        amountUsd: Math.round(amount),
        message,
        socialX,
        socialTiktok,
        socialInstagram,
        socialYoutube,
        socialTwitch
      }).catch(() => {});
    });
  }
}

async function startCheckout(payload) {
  try {
    // Persist socials locally as a fallback for confirm
    try {
      const { socialX, socialTiktok, socialInstagram, socialYoutube, socialTwitch } = payload;
      localStorage.setItem('mdd_socials', JSON.stringify({ socialX, socialTiktok, socialInstagram, socialYoutube, socialTwitch }));
    } catch {}
    const res = await fetch(`${API_BASE}/api/create-checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const { url } = await res.json();
      const dlg = document.getElementById('donateDialog');
      if (dlg && 'close' in dlg) dlg.close();
      window.location.href = url;
      return;
    }
  } catch {}
  // Fallback demo behavior if server not configured
  const entry = { name: payload.name, amountUsd: payload.amountUsd, date: new Date().toISOString(), message: payload.message };
  donors.unshift(entry);
  setProgress(sumUsd(donors));
  renderWall();
  try { launchConfetti(); } catch {}
  const dlg = document.getElementById('donateDialog');
  if (dlg && 'close' in dlg) dlg.close();
}
function launchConfetti() {
  const colors = ['#00e59b', '#62ffd1', '#ffffff', '#ffd166', '#ff5470'];
  const pieces = 28;
  for (let i = 0; i < pieces; i++) {
    const el = document.createElement('div');
    el.className = 'confetti';
    const left = (Math.random() * 60 - 30); // -30%..30% from center
    el.style.left = `calc(50% + ${left}vw)`;
    el.style.background = colors[i % colors.length];
    el.style.transform = `translateY(-20px) rotate(${Math.random() * 180}deg)`;
    el.style.animationDuration = `${900 + Math.random() * 700}ms`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  wireInteractions();
  await loadDonors();
  // Handle post-checkout confirmation (no-CLI fallback)
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('success') === '1' && params.get('session_id')) {
      const sessionId = params.get('session_id');
      let fallbackSocials = {};
      try {
        const saved = localStorage.getItem('mdd_socials');
        if (saved) fallbackSocials = JSON.parse(saved || '{}');
      } catch {}
      const res = await fetch(`${API_BASE}/api/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, socials: fallbackSocials })
      });
      if (res.ok) {
        await loadDonors();
        try { launchConfetti(); } catch {}
        // remove query params
        const url = new URL(window.location.href);
        url.search = '';
        window.history.replaceState({}, document.title, url.toString());
        try { localStorage.removeItem('mdd_socials'); } catch {}
      }
    }
  } catch {}
});

