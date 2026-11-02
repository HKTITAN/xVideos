// X Video Tab: the Videos nav item, the feeds, and the three views
// (grid, watch, reels). Runs in the content-script world of the top frame;
// video posts arrive from hook.js by postMessage.
(() => {
  if (window.top !== window || window.__xvtApp) return;
  window.__xvtApp = true;

  if (location.hash === '#xvt-reload') {
    history.replaceState(history.state, '', location.pathname + location.search);
    chrome.runtime.sendMessage('xvt:reload').catch(() => {});
    setTimeout(() => location.reload(), 600);
    return;
  }

  // X already owns /i/videos (its embed player, drawn without the app shell);
  // an unknown /i/ path keeps X's sidebar on a direct load.
  const ROUTE = '/i/videotab';
  const TITLE = 'Videos / X';

  const FEEDS = [
    { id: 'foryou', label: 'For you', icon: 'home', path: '/home' },
    { id: 'popular', label: 'Popular', icon: 'flame', q: 'filter:native_video min_faves:5000', tab: 'top' },
    { id: 'fresh', label: 'Fresh', icon: 'clock', q: 'filter:native_video min_faves:300', tab: 'live' },
    { id: 'following', label: 'Following', icon: 'people', q: 'filter:native_video filter:follows', tab: 'live' },
    { id: 'bookmarks', label: 'Bookmarks', icon: 'bookmark', path: '/i/bookmarks' },
  ];

  const isShort = (it) => it.ar < 0.8;

  // ---------- small helpers ----------

  const store = {
    get(k, d) { try { const v = localStorage.getItem('xvt:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('xvt:' + k, JSON.stringify(v)); } catch {} },
  };

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
    return el;
  }

  const nf = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
  const count = (n) => nf.format(n || 0);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  function ago(t) {
    const s = (t - Date.now()) / 1000;
    const steps = [[60, 'second'], [60, 'minute'], [24, 'hour'], [7, 'day'], [4.35, 'week'], [12, 'month'], [Infinity, 'year']];
    let v = s;
    for (const [n, unit] of steps) {
      if (Math.abs(v) < n) return rtf.format(Math.round(v), unit);
      v /= n;
    }
    return '';
  }

  function clock(ms) {
    const s = Math.round(ms / 1000);
    const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    return (hh ? hh + ':' + String(mm).padStart(2, '0') : mm) + ':' + String(ss).padStart(2, '0');
  }

  const title = (it) => (it.text.split('\n').find((l) => l.trim()) || '').trim() || `Video from @${it.author.handle}`;
  const postUrl = (it) => `/${it.author.handle}/status/${it.id}`;
  const thumb = (it, size = 'small') => `${it.poster}?name=${size}`;

  function linkify(text) {
    const frag = document.createDocumentFragment();
    const re = /(https?:\/\/[^\s]+)|(@\w{1,15})|(#[\p{L}\p{N}_]+)/gu;
    let last = 0, m;
    while ((m = re.exec(text))) {
      frag.append(text.slice(last, m.index));
      const [s] = m;
      const href = m[1] ? s : m[2] ? '/' + s.slice(1) : '/hashtag/' + s.slice(1);
      frag.append(h('a', { href, target: m[1] ? '_blank' : null, rel: m[1] ? 'noopener noreferrer' : null }, m[1] ? s.replace(/^https?:\/\/(www\.)?/, '') : s));
      last = m.index + s.length;
    }
    frag.append(text.slice(last));
    return frag;
  }

  // 24px stroke icons, drawn for this extension.
  const P = {
    grid: '<rect x="3.5" y="4.5" width="7" height="6" rx="1.5"/><rect x="13.5" y="4.5" width="7" height="6" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="6" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="6" rx="1.5"/>',
    reels: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 9.5v5l4-2.5z" fill="currentColor" stroke="none"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    back: '<path d="M19 12H5m6-6-6 6 6 6"/>',
    heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/>',
    reply: '<path d="M4.5 11.5a7 7 0 0 1 7-7h1a7 7 0 0 1 0 14H8l-3.5 2.5v-4a7 7 0 0 1 0-5.5z"/>',
    repost: '<path d="M7 7.5h9.5a2 2 0 0 1 2 2V13M17 16.5H7.5a2 2 0 0 1-2-2V11"/><path d="m4 8.5 3-3 3 3M20 15.5l-3 3-3-3"/>',
    views: '<path d="M4.5 19.5v-6m5 6v-11m5 11v-8m5 8v-14"/>',
    open: '<path d="M13.5 4.5h6v6m0-6-8 8"/><path d="M18 14v4a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 18V8a1.5 1.5 0 0 1 1.5-1.5H10"/>',
    link: '<path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1"/><path d="M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1"/>',
    sound: '<path d="M4.5 9.5h3l4-3.5v12l-4-3.5h-3z"/><path d="M15.5 9a4 4 0 0 1 0 6m2.5-8.5a7.5 7.5 0 0 1 0 11"/>',
    mute: '<path d="M4.5 9.5h3l4-3.5v12l-4-3.5h-3z"/><path d="m16 9.5 5 5m0-5-5 5"/>',
    play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>',
    pause: '<path d="M8 5.5v13M16 5.5v13" stroke-width="3"/>',
    up: '<path d="m6 14.5 6-6 6 6"/>',
    down: '<path d="m6 9.5 6 6 6-6"/>',
    home: '<path d="M4.5 10.5 12 4.5l7.5 6v8a1.5 1.5 0 0 1-1.5 1.5h-3.5v-6h-5v6H6a1.5 1.5 0 0 1-1.5-1.5z"/>',
    flame: '<path d="M12 20.5c3.6 0 6-2.4 6-5.8 0-3.9-3.2-6.2-4.3-10.2-2.4 1.6-3.6 4-3.4 6.4-1-.6-1.7-1.7-1.9-2.9C6.9 9.6 6 11.9 6 14.7c0 3.4 2.4 5.8 6 5.8z"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
    people: '<circle cx="9" cy="8.5" r="3.5"/><path d="M3 19.5c.6-3.2 3-5 6-5s5.4 1.8 6 5"/><path d="M15.5 5.2a3.5 3.5 0 0 1 0 6.6M17.5 14.8c1.8.6 3.1 2.3 3.5 4.7"/>',
    bookmark: '<path d="M6.5 4.5h11v15.5L12 16l-5.5 4z"/>',
    close: '<path d="m7 7 10 10M17 7 7 17"/>',
    shorts: '<rect x="7" y="3" width="10" height="18" rx="3"/><path d="M11 9.5v5l3.5-2.5z" fill="currentColor" stroke="none"/>',
    heartf: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" fill="currentColor"/>',
    bookmarkf: '<path d="M6.5 4.5h11v15.5L12 16l-5.5 4z" fill="currentColor"/>',
    next: '<path d="M6 6v12l9-6z" fill="currentColor"/><path d="M18 6v12" stroke-width="2.25"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2m0 12.6v2.2M3.5 12h2.2m12.6 0h2.2M6 6l1.6 1.6m8.8 8.8L18 18M6 18l1.6-1.6m8.8-8.8L18 6"/>',
    theater: '<rect x="2.5" y="6.5" width="19" height="11" rx="2"/>',
    pip: '<rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="11.5" width="6.5" height="5" rx="1" fill="currentColor"/>',
    full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    unfull: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    send: '<path d="M4 12 20 4l-4 16-4-6.5z"/><path d="m12 13.5 8-9.5"/>',
  };
  const icon = (n, cls = '') => h('span', { class: 'xvt-i ' + cls, 'aria-hidden': 'true', html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${P[n]}</svg>` });

  // ---------- data ----------

  const S = {
    items: new Map(),
    feeds: {}, // id -> { ids: [], frame, asked, lastSize, stalls, ended, started }
    feed: store.get('feed', 'foryou'),
    custom: store.get('custom', []), // [{ id, label, q }]
    mode: 'grid',
    muted: store.get('muted', false),
    volume: store.get('volume', 1),
    maxH: store.get('maxH', 0), // 0 = auto
    autoplay: store.get('autoplay', true),
  };

  const allFeeds = () => FEEDS.concat(S.custom.map((c) => ({ ...c, icon: 'search', tab: 'top', custom: true })));

  // Where you stopped in each video, so cards can show a watched bar and
  // the player can resume. Kept to the last 400 videos.
  const progress = store.get('progress', {});
  let progressTimer = 0;
  function saveProgress(id, t, d) {
    if (!d || d < 4) return;
    if (t > d - 2 || t < 2) delete progress[id];
    else progress[id] = [Math.round(t), Math.round(d), Date.now()];
    clearTimeout(progressTimer);
    progressTimer = setTimeout(() => {
      const keys = Object.keys(progress);
      if (keys.length > 400) keys.sort((a, b) => progress[a][2] - progress[b][2]).slice(0, keys.length - 400).forEach((k) => delete progress[k]);
      store.set('progress', progress);
    }, 800);
  }
  const watched = (id) => (progress[id] ? progress[id][0] / progress[id][1] : 0);
  const feedDef = (id) => allFeeds().find((f) => f.id === id) || FEEDS[0];
  if (!allFeeds().some((f) => f.id === S.feed)) S.feed = 'foryou';

  // A feed's ids are its live posts, then saved ones from earlier visits
  // (`saved`), so a feed is never blank while X is slow or returns nothing.
  function feed(id) {
    return (S.feeds[id] ||= { ids: [], live: 0, saved: new Set(), frame: null, asked: 0, lastSize: 0, stalls: 0, ended: false, started: 0 });
  }

  const valid = (it) => it && typeof it.id === 'string' && Array.isArray(it.variants) && it.variants.length && it.author;

  // ---------- saved videos (chrome.storage, survives X's own storage) ----------

  const CACHE_PER_FEED = 60;
  let cacheTimer = 0;
  const local = chrome.storage?.local;

  function saveCache() {
    clearTimeout(cacheTimer);
    cacheTimer = setTimeout(() => {
      const feeds = {}, items = {};
      for (const [id, f] of Object.entries(S.feeds)) {
        if (id === 'saved') continue;
        feeds[id] = f.ids.slice(0, CACHE_PER_FEED);
        for (const x of feeds[id]) { const it = S.items.get(x); if (it) items[x] = it; }
      }
      local?.set({ cache: { v: 1, at: Date.now(), feeds, items } }).catch(() => {});
    }, 1500);
  }

  function adopt(id, list, asSaved) {
    const f = feed(id);
    const fresh = [];
    for (const it of list) {
      if (!valid(it)) continue;
      if (!S.items.has(it.id) || !asSaved) S.items.set(it.id, it);
      if (f.ids.includes(it.id)) { if (!asSaved) f.saved.delete(it.id); continue; }
      if (asSaved) { f.saved.add(it.id); f.ids.push(it.id); }
      else { f.ids.splice(f.live++, 0, it.id); }
      fresh.push(it.id);
    }
    return fresh;
  }

  const ready = (async () => {
    let cache = null;
    try { cache = (await local?.get('cache'))?.cache; } catch {}
    if (!cache?.feeds) {
      try { cache = await (await fetch(chrome.runtime.getURL('src/seed.json'))).json(); } catch {}
      if (cache) cache.seed = true;
    }
    if (!cache?.feeds) return;
    for (const [id, ids] of Object.entries(cache.feeds)) adopt(id, ids.map((x) => cache.items[x]), true);
    S.seeded = !!cache.seed;
  })();

  // Everything saved, across feeds: the fallback when one feed has nothing.
  function pool(except) {
    const seen = new Set(feed(except).ids), out = [];
    for (const [id, f] of Object.entries(S.feeds)) if (id !== except && id !== 'saved') for (const x of f.ids) if (!seen.has(x)) { seen.add(x); out.push(x); }
    return out;
  }

  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.data?.__xvt !== 'items') return;
    const { op, items } = e.data;
    let id = e.data.feed;
    if (!id) {
      if (!/^Home/.test(op)) return; // only the home timeline feeds "For you" from normal browsing
      id = 'foryou';
    }
    if (!Array.isArray(items) || !items.length) return;
    const f = feed(id);
    const hadLive = f.live > 0;
    const fresh = adopt(id, items, false);
    if (fresh.length) {
      f.stalls = 0;
      saveCache();
      if (id === S.feed) UI.onItems(fresh, !hadLive && f.saved.size > 0);
    }
  });

  const MAX_FRAMES = 3;
  let frameOrder = [];

  // xvtfeed=1 is the only URL rules.json lets into a frame, so x.com stays
  // unframeable everywhere else. X's service worker answers navigations from
  // a cached app shell (which says DENY) unless the URL has `lang`, so the
  // frame asks in the language X is already using.
  function frameSrc(def) {
    const lang = encodeURIComponent(document.documentElement.lang || 'en');
    const tail = `xvtfeed=1&lang=${lang}`;
    if (def.path) return `${def.path}?${tail}`;
    return `/search?q=${encodeURIComponent(def.q)}&src=typed_query&f=${def.tab || 'top'}&${tail}`;
  }

  function startFeed(id) {
    const f = feed(id);
    frameOrder = frameOrder.filter((x) => x !== id).concat(id);
    if (f.frame?.isConnected) return;
    while (frameOrder.length > MAX_FRAMES) {
      const old = feed(frameOrder.shift());
      old.frame?.remove();
      old.frame = null;
    }
    const fr = h('iframe', { name: 'xvt:' + id, src: frameSrc(feedDef(id)), class: 'xvt-feeder', tabindex: '-1', 'aria-hidden': 'true' });
    // A frame that never delivers (blocked, logged out, X changed) is retried once.
    fr.addEventListener('load', () => {
      setTimeout(() => {
        if (f.frame !== fr || f.live) return;
        let ok = false;
        try { ok = !!fr.contentDocument; } catch {}
        if (!ok && !f.retried) { f.retried = true; fr.remove(); f.frame = null; startFeed(id); }
        else if (!ok) UI.onEnd(id);
      }, 4000);
    });
    document.documentElement.append(fr);
    f.frame = fr;
    f.started = Date.now();
    f.ended = false;
    f.stalls = 0;
  }

  // Ask the feeder frame for its next page. Three asks with nothing new = the end.
  function more(id) {
    const f = feed(id);
    if (f.ended) return;
    if (!f.frame?.isConnected) { startFeed(id); return; }
    const now = Date.now();
    if (now - f.asked < 1800) return;
    if (f.live === f.lastSize && f.asked) {
      if (++f.stalls >= 4) { f.ended = true; UI.onEnd(id); return; }
    }
    f.lastSize = f.live;
    f.asked = now;
    f.frame.contentWindow?.postMessage({ __xvt: 'more' }, location.origin);
  }

  function pickVariant(it, box) {
    const v = it.variants;
    if (S.maxH) return [...v].reverse().find((x) => (x.h && x.w ? Math.min(x.w, x.h) : 0) <= S.maxH) || v[0];
    const want = Math.min(1080, (box || 720) * (window.devicePixelRatio || 1));
    return v.find((x) => Math.min(x.w, x.h) >= want * 0.9) || v[v.length - 1];
  }

  function qualities(it) {
    const out = new Map();
    for (const v of it.variants) if (v.w && v.h) out.set(Math.min(v.w, v.h), v);
    return [...out.keys()].sort((a, b) => b - a);
  }

  // Plays `it` in `video`: the chosen variant first, then each smaller one on
  // an error or a long stall, then the larger ones. `frame` gets the
  // buffering spinner and, when every variant fails, the error panel.
  function playback(video, it, frame, { box = 720, onFail } = {}) {
    const first = pickVariant(it, box);
    const below = it.variants.filter((v) => v.bitrate < first.bitrate).reverse();
    const above = it.variants.filter((v) => v.bitrate > first.bitrate);
    const order = [first, ...below, ...above];
    let i = 0, stall = 0, spin = 0, dead = false;
    const spinner = h('div', { class: 'xvt-spinner', 'aria-hidden': 'true' }, h('i'));
    const fail = h('div', { class: 'xvt-fail', hidden: true, role: 'alert' });
    frame.append(spinner, fail);

    const waiting = (on) => {
      clearTimeout(spin);
      if (on) spin = setTimeout(() => spinner.classList.add('xvt-on'), 350);
      else spinner.classList.remove('xvt-on');
    };

    function set(n, keepTime) {
      i = n;
      const t = keepTime ? video.currentTime : 0;
      const playing = !video.paused || video.autoplay;
      video.src = order[i].url;
      if (t) video.addEventListener('loadedmetadata', () => { video.currentTime = t; }, { once: true });
      if (playing) video.play().catch(() => {});
    }

    function next() {
      if (dead || !video.getAttribute('src')) return;
      if (i + 1 < order.length) { set(i + 1, true); return; }
      dead = true;
      waiting(false);
      fail.hidden = false;
      fail.replaceChildren(
        h('b', null, 'This video won’t play here'),
        h('span', null, 'X may have removed it, or the network dropped.'),
        h('div', { class: 'xvt-fail-row' },
          h('button', { type: 'button', class: 'xvt-btn xvt-btn-light', onclick: (e) => { e.stopPropagation(); retry(); } }, 'Try again'),
          h('a', { class: 'xvt-btn xvt-btn-ghost', href: postUrl(it), onclick: (e) => e.stopPropagation() }, 'Open on X')),
      );
      onFail?.();
    }

    function retry() { dead = false; fail.hidden = true; set(0, false); video.play().catch(() => {}); }

    video.addEventListener('error', next);
    video.addEventListener('waiting', () => {
      waiting(true);
      clearTimeout(stall);
      stall = setTimeout(() => { if (video.readyState < 3 && !video.paused) next(); }, 9000);
    });
    for (const ev of ['playing', 'canplay', 'pause', 'seeked']) video.addEventListener(ev, () => { waiting(false); clearTimeout(stall); });

    return {
      start() { if (!video.src) set(0, false); },
      stop() { clearTimeout(stall); waiting(false); },
      setQuality() { const v = pickVariant(it, box); const n = order.indexOf(v); set(n < 0 ? 0 : n, true); },
      retry,
    };
  }

  // ---------- threads: replies and actions through X's own page ----------
  //
  // X signs every write with a header its client computes per request, so the
  // extension never calls the API itself. A post's own X page loads in a
  // hidden frame; hook.js reports its state and replies from X's TweetDetail
  // response, and actions click X's real buttons inside that frame.

  const threads = new Map(); // id -> thread
  const MAX_THREADS = 3;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function until(fn, ms) {
    const end = Date.now() + ms;
    for (;;) {
      let v = null;
      try { v = fn(); } catch {}
      if (v) return v;
      if (Date.now() > end) return null;
      await wait(150);
    }
  }

  // Threads are cheap objects; only the most recent few hold a frame. A
  // thread wakes (gets its frame back) whenever something needs it.
  let liveThreads = [];

  function getThread(it, { lazy } = {}) {
    let T = threads.get(it.id);
    if (!T) {
      let resolveReady;
      T = {
        it, frame: null, state: null, replies: [], more: false, failed: false, busy: {},
        ready: new Promise((r) => (resolveReady = r)),
        subs: new Set(),
        on(fn) { T.subs.add(fn); return () => T.subs.delete(fn); },
        emit() { for (const fn of T.subs) fn(T); },
        loadMore() { T.wake(); T.frame.contentWindow?.postMessage({ __xvt: 'more' }, location.origin); },
        wake() {
          liveThreads = liveThreads.filter((x) => x !== T).concat(T);
          while (liveThreads.length > MAX_THREADS) { const old = liveThreads.shift(); old.frame?.remove(); old.frame = null; }
          if (T.frame?.isConnected) return;
          const lang = encodeURIComponent(document.documentElement.lang || 'en');
          T.frame = h('iframe', { name: 'xvt:thread:' + it.id, src: `${postUrl(it)}?xvtfeed=1&lang=${lang}`, class: 'xvt-feeder', tabindex: '-1', 'aria-hidden': 'true' });
          document.documentElement.append(T.frame);
          clearTimeout(T.giveUp);
          T.giveUp = setTimeout(() => { if (!T.state) { T.failed = true; T.resolve(); T.emit(); } }, 15000);
        },
      };
      T.resolve = () => resolveReady(true);
      threads.set(it.id, T);
    }
    if (!lazy) T.wake();
    return T;
  }

  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.data?.__xvt !== 'thread') return;
    const T = threads.get(e.data.id);
    if (!T) return;
    if (e.data.state) {
      const s = e.data.state;
      // An action in flight owns its own flag until X confirms it.
      T.state = { ...(T.state || {}), ...s };
      for (const k of Object.keys(T.busy)) if (T.busy[k]) T.state[k] = T.busy[k].want;
      T.failed = false;
    }
    const seen = new Set(T.replies.map((r) => r.id));
    for (const r of e.data.replies || []) if (r?.id && !seen.has(r.id)) T.replies.push(r);
    T.more = !!e.data.more;
    T.resolve();
    T.emit();
  });

  function focalArticle(doc, id) {
    const arts = [...doc.querySelectorAll('article[data-testid="tweet"]')];
    return arts.find((a) => a.querySelector(`a[href*="/status/${id}"] time`)) || arts.find((a) => a.getAttribute('tabindex') === '-1') || null;
  }

  const ACTIONS = {
    liked: { on: 'like', off: 'unlike', count: 'likes' },
    reposted: { on: 'retweet', off: 'unretweet', count: 'reposts', confirm: ['retweetConfirm', 'unretweetConfirm'] },
    bookmarked: { on: 'bookmark', off: 'removeBookmark', count: 'bookmarks' },
  };

  // Flips `key` (liked / reposted / bookmarked) optimistically, clicks X's
  // button in the thread frame, and waits for X to show the new state.
  async function act(T, key, force) {
    const A = ACTIONS[key];
    if (T.busy[key]) return;
    T.wake();
    await Promise.race([T.ready, wait(8000)]);
    const before = !!T.state?.[key];
    const want = force ?? !before;
    if (want === before) return;
    T.busy[key] = { want };
    T.state = { ...(T.state || {}), [key]: want, [A.count]: Math.max(0, (T.state?.[A.count] ?? T.it[A.count] ?? 0) + (want ? 1 : -1)) };
    T.emit();
    let ok = false;
    try {
      const art = await until(() => focalArticle(T.frame.contentDocument, T.it.id), 10000);
      const btn = art?.querySelector(`[data-testid="${want ? A.on : A.off}"]`);
      if (btn) {
        btn.click();
        if (A.confirm) (await until(() => T.frame.contentDocument.querySelector(`[data-testid="${A.confirm[want ? 0 : 1]}"]`), 3000))?.click();
        ok = !!(await until(() => art.querySelector(`[data-testid="${want ? A.off : A.on}"]`), 5000));
      }
    } catch {}
    delete T.busy[key];
    if (!ok) {
      T.state = { ...T.state, [key]: before, [A.count]: Math.max(0, T.state[A.count] + (want ? -1 : 1)) };
      UI.toast(`Couldn’t ${{ liked: 'like', reposted: 'repost', bookmarked: 'bookmark' }[key]} that post. Try again, or open it on X.`);
    }
    T.emit();
    return ok;
  }

  // Types into the reply box on the post's own X page and sends it. Returns
  // false when X's composer can't be found, so the caller can fall back.
  async function sendReply(T, text) {
    T.wake();
    try {
      const doc = await until(() => T.frame.contentDocument?.querySelector('[data-testid="tweetTextarea_0"]') && T.frame.contentDocument, 10000);
      if (!doc) return false;
      const box = doc.querySelector('[data-testid="tweetTextarea_0"]');
      const active = document.activeElement;
      box.focus();
      doc.execCommand('selectAll', false);
      doc.execCommand('insertText', false, text);
      const btn = await until(() => { const b = doc.querySelector('[data-testid="tweetButtonInline"]'); return b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' && b; }, 3000);
      active?.focus?.();
      if (!btn) return false;
      btn.click();
      return !!(await until(() => !doc.querySelector('[data-testid="tweetTextarea_0"]')?.textContent.trim(), 8000));
    } catch { return false; }
  }

  function replyIntent(it) {
    window.open(`https://x.com/intent/post?in_reply_to=${it.id}`, 'xvt-reply', 'width=600,height=640');
  }

  function me() {
    const a = document.querySelector('[data-testid="AppTabBar_Profile_Link"]');
    const img = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"] img');
    return { handle: a?.getAttribute('href')?.slice(1) || '', avatar: img?.src || '' };
  }

  // ---------- search suggestions (X's own typeahead) ----------

  let bearer = null;
  async function token() {
    if (bearer) return bearer;
    const src = [...document.scripts].map((s) => s.src).find((s) => /\/main\.[\w]+\.js/.test(s));
    if (!src) return null;
    const txt = await (await fetch(src)).text();
    const m = txt.match(/"(AAAAAAAAAAAAAAAAAAAAA[\w%]+)"/);
    return (bearer = m ? decodeURIComponent(m[1]) : null);
  }

  async function suggest(q, signal) {
    const t = await token();
    const ct0 = document.cookie.match(/(?:^|; )ct0=([^;]+)/)?.[1];
    if (!t || !ct0) return null;
    const url = `/i/api/1.1/search/typeahead.json?include_ext_is_blue_verified=1&q=${encodeURIComponent(q)}&src=search_box&result_type=events%2Cusers%2Ctopics%2Clists`;
    const r = await fetch(url, { signal, credentials: 'include', headers: { authorization: 'Bearer ' + t, 'x-csrf-token': ct0, 'x-twitter-auth-type': 'OAuth2Session', 'x-twitter-active-user': 'yes' } });
    if (!r.ok) return null;
    const j = await r.json();
    return {
      topics: (j.topics || []).map((x) => x.topic).filter(Boolean).slice(0, 5),
      users: (j.users || []).slice(0, 4).map((u) => ({ name: u.name, handle: u.screen_name, avatar: u.profile_image_url_https, verified: !!(u.verified || u.ext_is_blue_verified) })),
    };
  }

  // ---------- the nav item ----------

  const NAV_ICON = {
    off: 'M5 4h14a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zm0 2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1H5zm5 2.8v6.4a.5.5 0 0 0 .76.43l5.2-3.2a.5.5 0 0 0 0-.86l-5.2-3.2A.5.5 0 0 0 10 8.8z',
    on: 'M5 4h14a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zm5 4.8v6.4a.5.5 0 0 0 .76.43l5.2-3.2a.5.5 0 0 0 0-.86l-5.2-3.2A.5.5 0 0 0 10 8.8z',
  };

  function ensureNav() {
    const nav = document.querySelector('nav[aria-label="Primary"]');
    if (!nav || nav.querySelector('[data-testid="AppTabBar_Videos_Link"]')) return;
    const ref = nav.querySelector('a[href="/explore"]') || nav.querySelector('a[href="/home"]');
    if (!ref) return;
    const a = ref.cloneNode(true);
    a.href = ROUTE;
    a.setAttribute('aria-label', 'Videos');
    a.setAttribute('data-testid', 'AppTabBar_Videos_Link');
    a.removeAttribute('aria-current');
    const g = a.querySelector('svg g') || a.querySelector('svg');
    if (g) g.innerHTML = `<path fill-rule="evenodd" d="${NAV_ICON.off}"></path>`;
    const spans = a.querySelectorAll('span');
    if (spans[0]) spans[0].textContent = 'Videos';
    a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
      e.preventDefault();
      e.stopPropagation();
      go({});
    }, true);
    ref.after(a);
    markNav();
  }

  function markNav() {
    const a = document.querySelector('[data-testid="AppTabBar_Videos_Link"]');
    if (!a) return;
    const on = isOpen();
    const p = a.querySelector('svg path');
    if (p) p.setAttribute('d', on ? NAV_ICON.on : NAV_ICON.off);
    a.classList.toggle('xvt-nav-on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }

  // ---------- routing ----------

  const isOpen = () => location.pathname === ROUTE;

  function readRoute() {
    const p = new URLSearchParams(location.search);
    return { v: p.get('v'), mode: p.get('mode') === 'reels' ? 'reels' : 'grid' };
  }

  function go(r, replace) {
    const p = new URLSearchParams();
    if (r.mode === 'reels') p.set('mode', 'reels');
    if (r.v) p.set('v', r.v);
    const url = ROUTE + (p.toString() ? '?' + p : '');
    if (url === location.pathname + location.search) return sync();
    history[replace ? 'replaceState' : 'pushState']({ xvt: 1 }, '', url);
    sync();
  }

  let lastHref = '';
  function sync() {
    if (isOpen() && document.title !== TITLE) document.title = TITLE;
    if (location.href === lastHref) return;
    lastHref = location.href;
    if (isOpen()) UI.show(readRoute()); else UI.hide();
    markNav();
  }

  addEventListener('popstate', () => setTimeout(sync));

  let navQueued = false;
  new MutationObserver(() => {
    if (navQueued) return;
    navQueued = true;
    requestAnimationFrame(() => { navQueued = false; ensureNav(); UI.place(); });
  }).observe(document.documentElement, { childList: true, subtree: true });

  // ---------- UI ----------

  const UI = (() => {
    let root, head, body, chipsEl, gridEl, sentinel, shelf, shelfRow, view = null, current = null;
    let watch = null, reels = null, io = null, emptyTimer = 0, noticeEl = null, revealGrid = null, skin = '';

    function theme() {
      const bg = getComputedStyle(document.body).backgroundColor;
      const m = bg.match(/\d+/g) || [255, 255, 255];
      const lum = (+m[0] * 299 + +m[1] * 587 + +m[2] * 114) / 1000;
      return lum > 128 ? 'light' : +m[2] > 30 ? 'dim' : 'dark';
    }

    function place() {
      if (!root || root.hidden) return;
      const header = document.querySelector('header[role="banner"]');
      const r = header?.getBoundingClientRect();
      const left = r && r.width > 0 && r.width < innerWidth / 2 ? Math.round(r.right) : 0;
      root.style.left = left + 'px';
      const bar = document.querySelector('[data-testid="BottomBar"]');
      root.style.bottom = bar ? bar.getBoundingClientRect().height + 'px' : '0px';
      const t = theme();
      root.dataset.theme = t;
      if (t !== skin) {
        skin = t;
        const tone = { light: ['#eff3f4', '#f7f9f9'], dim: ['#1e2732', '#273340'], dark: ['#16181c', '#212327'] }[t];
        const colors = { base: tone[0], highlight: tone[1] };
        try { XvtSkullet.applyTheme({ light: colors, dark: colors, radius: '6px', animation: 'shimmer' }, t === 'light' ? 'light' : 'dark'); } catch {}
      }
    }
    addEventListener('resize', place);

    function build() {
      chipsEl = h('div', { class: 'xvt-chips', role: 'tablist', 'aria-label': 'Feeds' });
      const search = buildSearch();

      const toggle = h('div', { class: 'xvt-seg', role: 'radiogroup', 'aria-label': 'Layout' },
        h('button', { type: 'button', role: 'radio', 'data-mode': 'grid', title: 'Grid (G)', onclick: () => go({ mode: 'grid' }) }, icon('grid'), h('span', null, 'Grid')),
        h('button', { type: 'button', role: 'radio', 'data-mode': 'reels', title: 'Reels (R)', onclick: () => go({ mode: 'reels', v: current }) }, icon('reels'), h('span', null, 'Reels')),
      );

      head = h('div', { class: 'xvt-head' },
        h('div', { class: 'xvt-bar' }, h('h1', { class: 'xvt-h1' }, 'Videos'), search, toggle),
        chipsEl,
      );
      body = h('div', { class: 'xvt-body' });
      root = h('div', { id: 'xvt-root', hidden: true }, head, body);
      document.body.append(root);
      overlayScrollbar(body);
      renderChips();
    }

    // The main column's scrollbar, drawn over the content: it appears while
    // you scroll or hover the right edge, and its thumb drags.
    function overlayScrollbar(el) {
      const thumb = h('i');
      const bar = h('div', { class: 'xvt-osb', 'aria-hidden': 'true' }, thumb);
      root.append(bar);
      let hideT = 0, drag = null;
      function paint() {
        const { scrollTop, scrollHeight, clientHeight, offsetTop } = el;
        bar.style.top = offsetTop + 'px';
        bar.style.height = clientHeight + 'px';
        if (scrollHeight <= clientHeight + 1) { bar.hidden = true; return; }
        bar.hidden = false;
        const th = Math.max(32, (clientHeight * clientHeight) / scrollHeight);
        thumb.style.height = th + 'px';
        thumb.style.transform = `translateY(${(scrollTop / (scrollHeight - clientHeight)) * (clientHeight - th)}px)`;
      }
      function flash() {
        paint();
        bar.classList.add('xvt-on');
        clearTimeout(hideT);
        hideT = setTimeout(() => { if (!drag) bar.classList.remove('xvt-on'); }, 900);
      }
      el.addEventListener('scroll', flash, { passive: true });
      new ResizeObserver(paint).observe(el);
      root.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        if (e.clientX > r.right - 16 && e.clientY > r.top) flash();
      });
      thumb.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        drag = { y: e.clientY, top: el.scrollTop };
        thumb.setPointerCapture(e.pointerId);
        bar.classList.add('xvt-drag');
      });
      thumb.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const ratio = (el.scrollHeight - el.clientHeight) / (el.clientHeight - thumb.offsetHeight);
        el.scrollTop = drag.top + (e.clientY - drag.y) * ratio;
      });
      thumb.addEventListener('pointerup', () => { drag = null; bar.classList.remove('xvt-drag'); flash(); });
      bar.addEventListener('pointerdown', (e) => {
        if (e.target !== bar) return;
        const r = bar.getBoundingClientRect();
        el.scrollBy({ top: (e.clientY - r.top < thumb.getBoundingClientRect().top - r.top ? -1 : 1) * el.clientHeight * 0.9, behavior: 'smooth' });
      });
    }

    // ----- search: X's own typeahead, recent searches, people -----

    function openSearch(id, label, q) {
      S.custom = [{ id, label, q }, ...S.custom.filter((c) => c.id !== id)].slice(0, 8);
      store.set('custom', S.custom);
      setFeed(id);
    }
    const searchFor = (q) => openSearch('q:' + q.toLowerCase(), q, q + ' filter:native_video');
    const searchUser = (u) => openSearch('u:' + u.handle.toLowerCase(), '@' + u.handle, `from:${u.handle} filter:native_video`);

    function buildSearch() {
      const input = h('input', { type: 'text', placeholder: 'Search videos', 'aria-label': 'Search videos', enterkeyhint: 'search', autocomplete: 'off', spellcheck: 'false',
        role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'xvt-suggest', 'aria-autocomplete': 'list' });
      const clear = h('button', { type: 'button', class: 'xvt-sclear', 'aria-label': 'Clear', hidden: true, onmousedown: (e) => e.preventDefault(), onclick: () => { input.value = ''; clear.hidden = true; update(); input.focus(); } }, icon('close'));
      const box = h('div', { class: 'xvt-suggest', id: 'xvt-suggest', role: 'listbox', hidden: true, onmousedown: (e) => e.preventDefault() });
      const form = h('form', { class: 'xvt-search', role: 'search', onsubmit: (e) => { e.preventDefault(); choose(sel >= 0 ? rows[sel] : null); } },
        icon('search'), input, clear, box);

      let rows = [], sel = -1, ctrl = null, timer = 0, lastQ = null;

      function choose(r) {
        const q = input.value.trim();
        if (!r && !q) return;
        close();
        input.value = ''; clear.hidden = true; input.blur();
        if (!r || r.kind === 'query') searchFor(r?.q || q);
        else if (r.kind === 'recent') setFeed(r.id);
        else if (r.kind === 'user') searchUser(r.u);
      }

      function row(r, i) {
        const el = h('div', { class: 'xvt-srow', role: 'option', id: 'xvt-s' + i, 'aria-selected': String(i === sel), onclick: () => choose(r), onmousemove: () => mark(i) },
          r.kind === 'user'
            ? h('img', { class: 'xvt-ava', src: r.u.avatar, alt: '' })
            : h('span', { class: 'xvt-sicon' }, icon(r.kind === 'recent' ? 'clock' : 'search')),
          r.kind === 'user'
            ? h('span', { class: 'xvt-lines' }, h('b', null, r.u.name), h('span', { class: 'xvt-sub' }, `@${r.u.handle} · videos`))
            : h('span', { class: 'xvt-stext' }, r.label),
          r.kind === 'recent' ? h('button', { type: 'button', class: 'xvt-chipx', 'aria-label': `Remove ${r.label}`, onclick: (e) => { e.stopPropagation(); removeCustom(r.id); update(true); } }, icon('close')) : null);
        return el;
      }

      function mark(i) {
        sel = i;
        box.querySelectorAll('.xvt-srow').forEach((el, j) => el.setAttribute('aria-selected', String(j === i)));
        input.setAttribute('aria-activedescendant', i >= 0 ? 'xvt-s' + i : '');
      }

      function paint(sections) {
        rows = sections.flatMap((s) => s.rows);
        sel = -1;
        if (!rows.length) { close(); return; }
        let i = 0;
        box.replaceChildren(...sections.filter((s) => s.rows.length).map((s) => h('div', { class: 'xvt-ssec' },
          s.title ? h('div', { class: 'xvt-shead' }, s.title) : null, s.rows.map((r) => row(r, i++)))));
        box.hidden = false;
        input.setAttribute('aria-expanded', 'true');
      }

      function close() { box.hidden = true; input.setAttribute('aria-expanded', 'false'); sel = -1; }

      function update(force) {
        const q = input.value.trim();
        clear.hidden = !input.value;
        if (q === lastQ && !force) return;
        lastQ = q;
        clearTimeout(timer);
        ctrl?.abort();
        if (!q) {
          paint([{ title: 'Recent', rows: S.custom.map((c) => ({ kind: 'recent', id: c.id, label: c.label })) }]);
          return;
        }
        const first = { kind: 'query', q, label: `Search videos for “${q}”` };
        paint([{ rows: [first] }]);
        timer = setTimeout(async () => {
          ctrl = new AbortController();
          let res = null;
          try { res = await suggest(q, ctrl.signal); } catch {}
          if (!res || input.value.trim() !== q) return;
          paint([
            { rows: [first, ...res.topics.filter((t) => t.toLowerCase() !== q.toLowerCase()).map((t) => ({ kind: 'query', q: t, label: t }))] },
            { title: 'People', rows: res.users.map((u) => ({ kind: 'user', u })) },
          ]);
        }, 140);
      }

      input.addEventListener('focus', () => update(true));
      input.addEventListener('input', () => update());
      input.addEventListener('blur', () => setTimeout(close, 120));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          if (box.hidden) { update(true); return; }
          e.preventDefault();
          const n = rows.length;
          mark(e.key === 'ArrowDown' ? (sel + 1) % n : (sel - 1 + n) % n);
        } else if (e.key === 'Escape') { if (!box.hidden) { e.stopPropagation(); close(); } else input.blur(); }
      });
      return form;
    }

    function renderChips() {
      chipsEl.replaceChildren(...allFeeds().map((f) => h('div', { class: 'xvt-chipwrap' + (f.custom ? ' xvt-custom' : '') },
        h('button', {
          type: 'button', role: 'tab', class: 'xvt-chip', 'aria-selected': String(f.id === S.feed),
          onclick: () => setFeed(f.id),
        }, icon(f.icon), h('span', null, f.label)),
        f.custom ? h('button', { type: 'button', class: 'xvt-chipx', 'aria-label': `Remove ${f.label}`, onclick: () => removeCustom(f.id) }, icon('close')) : null,
      )));
    }

    function removeCustom(id) {
      S.custom = S.custom.filter((c) => c.id !== id);
      store.set('custom', S.custom);
      if (S.feed === id) setFeed('foryou'); else renderChips();
    }

    function setFeed(id) {
      S.feed = id;
      store.set('feed', id);
      renderChips();
      chipsEl.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      startFeed(id);
      if (view === 'watch') go({ mode: 'grid' });
      else render();
    }

    function show(route) {
      if (!root) build();
      if (root.hidden) {
        root.hidden = false;
        document.documentElement.classList.add('xvt-lock');
      }
      place();
      startFeed(S.feed);
      const next = route.mode === 'reels' ? 'reels' : route.v ? 'watch' : 'grid';
      head.querySelectorAll('.xvt-seg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === (next === 'reels' ? 'reels' : 'grid'))));
      root.dataset.view = next;
      if (next === view && next === 'watch' && route.v === current) return;
      if (next === view && next === 'reels') { if (route.v && route.v !== current) reels?.jump(route.v); return; }
      if (next === view && next === 'grid') return;
      view = next;
      current = route.v || null;
      render();
    }

    function hide() {
      if (!root || root.hidden) return;
      teardown();
      view = null;
      root.hidden = true;
      body.replaceChildren();
      document.documentElement.classList.remove('xvt-lock');
    }

    function teardown() {
      watch?.destroy(); watch = null;
      reels?.destroy(); reels = null;
      io?.disconnect(); io = null;
      clearTimeout(emptyTimer);
    }

    function render() {
      teardown();
      const el = view === 'watch' ? (watch = Watch(current)).el : view === 'reels' ? (reels = Reels(current)).el : Grid();
      el.classList.add('xvt-enter');
      body.replaceChildren(el);
      body.scrollTop = 0;
    }

    // ----- grid -----

    function card(it) {
      const vid = h('video', { muted: true, playsinline: true, loop: true, preload: 'none', class: 'xvt-preview', disablepictureinpicture: true });
      vid.muted = true;
      let t = 0;
      const tall = it.ar < 1.45;
      if (it.sample) {
        return h('div', { class: 'xvt-card', 'aria-hidden': 'true' },
          h('div', { class: 'xvt-thumb' }),
          h('div', { class: 'xvt-meta' },
            h('span', { class: 'xvt-ava' }),
            h('div', { class: 'xvt-lines' },
              h('div', { class: 'xvt-title' }, it.text),
              h('div', { class: 'xvt-sub' }, it.author.name),
              h('div', { class: 'xvt-sub' }, '12K views · 1 hour ago'))));
      }
      const el = h('a', { class: 'xvt-card', href: postUrl(it), 'data-id': it.id,
        onclick: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); go({ v: it.id }); },
        onpointerenter: (e) => {
          if (e.pointerType !== 'mouse') return;
          t = setTimeout(() => {
            if (!vid.src) vid.src = it.variants[0].url;
            vid.play().then(() => el.classList.add('xvt-playing'), () => {});
          }, 550);
        },
        onpointerleave: () => { clearTimeout(t); el.classList.remove('xvt-playing'); vid.pause(); },
      },
        h('div', { class: 'xvt-thumb' + (tall ? ' xvt-tall' : '') },
          tall ? h('img', { class: 'xvt-blur', src: thumb(it, 'thumb'), alt: '', loading: 'lazy' }) : null,
          h('img', { class: 'xvt-poster', src: thumb(it), alt: '', loading: 'lazy', decoding: 'async' }),
          vid,
          h('span', { class: 'xvt-dur' }, clock(it.duration)),
          watchedBar(it.id),
        ),
        h('div', { class: 'xvt-meta' },
          h('img', { class: 'xvt-ava', src: it.author.avatar, alt: '', loading: 'lazy' }),
          h('div', { class: 'xvt-lines' },
            h('div', { class: 'xvt-title' }, title(it)),
            h('div', { class: 'xvt-sub' }, it.author.name || '@' + it.author.handle),
            h('div', { class: 'xvt-sub' }, `${count(it.views)} views · ${ago(it.created)}`),
          ),
        ),
      );
      return el;
    }

    function watchedBar(id) {
      const p = watched(id);
      return p ? h('span', { class: 'xvt-watched', style: `--p:${p.toFixed(3)}` }) : null;
    }

    // Vertical videos get their own shelf above the grid, the way Shorts do.
    function short(it) {
      return h('a', { class: 'xvt-short', href: postUrl(it), 'data-id': it.id,
        onclick: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); go({ mode: 'reels', v: it.id }); } },
        h('div', { class: 'xvt-sthumb' },
          h('img', { src: thumb(it), alt: '', loading: 'lazy', decoding: 'async' }),
          h('span', { class: 'xvt-sviews' }, `${count(it.views)} views`),
          watchedBar(it.id)),
        h('div', { class: 'xvt-title' }, title(it)),
      );
    }

    // ----- loading states (skullet measures a sample render) -----

    const SAMPLE = {
      id: 'sample', sample: true, text: 'A video title long enough to wrap onto a second line',
      author: { name: 'Sample author', handle: 'sample', avatar: '' }, poster: '', ar: 16 / 9,
      duration: 61000, variants: [{ url: '' }], views: 12000, created: Date.now() - 36e5,
    };

    // A measured skeleton in `host` from `sample`, or plain bars when skullet
    // is missing or throws. Returns show(node), which swaps the real content in.
    function skeletonIn(host, sample, key, label) {
      try {
        const r = new XvtSkullet.Reveal(host, { id: 'xvt-' + key, label, reveal: 'smart' });
        r.load(sample);
        return (node) => { try { r.show(node); } catch { host.replaceChildren(node); } };
      } catch {
        sample.classList?.add('xvt-skel');
        host.replaceChildren(sample);
        return (node) => host.replaceChildren(node);
      }
    }

    function sampleGrid(n) {
      return h('div', { class: 'xvt-grid' }, Array.from({ length: n }, () => card(SAMPLE)));
    }

    function notice(text, action) {
      return h('div', { class: 'xvt-notice', role: 'status' }, icon('clock'), h('span', null, text), action || null);
    }

    function Grid() {
      const f = feed(S.feed);
      const def = feedDef(S.feed);
      gridEl = h('div', { class: 'xvt-grid' });
      sentinel = h('div', { class: 'xvt-sentinel' });
      shelfRow = h('div', { class: 'xvt-shelf-row' });
      shelf = h('section', { class: 'xvt-shelf', hidden: true, 'aria-label': 'Shorts' },
        h('div', { class: 'xvt-shelf-head' }, icon('shorts'), h('b', null, 'Shorts'),
          h('button', { type: 'button', class: 'xvt-link', onclick: () => go({ mode: 'reels', v: f.ids.map((id) => S.items.get(id)).find(isShort)?.id }) }, 'Watch as reels')),
        shelfRow);
      noticeEl = h('div');
      const host = h('div');
      const wrap = h('div', { class: 'xvt-gridwrap' }, noticeEl, shelf, host, sentinel);
      revealGrid = null;
      if (f.ids.length) {
        host.append(gridEl);
        addToGrid(f.ids);
        if (!f.live) noticeEl.replaceChildren(notice(S.seeded ? 'Starter videos while X loads your feed' : `Saved from your last visit · loading new ${def.label} videos`));
      } else {
        revealGrid = skeletonIn(host, sampleGrid(8), 'grid', 'Loading videos');
        armEmpty();
      }
      io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) more(S.feed); }, { root: body, rootMargin: '1200px 0px' });
      io.observe(sentinel);
      if (f.ended) onEnd(S.feed);
      return wrap;
    }

    // Shorts sit in the grid until there are enough to fill a shelf; one or
    // two on a shelf would leave an empty band across the page.
    const SHELF_MIN = 4;
    function addToGrid(ids) {
      const its = ids.map((id) => S.items.get(id)).filter(valid);
      const shelved = !shelf.hidden;
      gridEl.append(...its.filter((it) => !(shelved && isShort(it))).map(card));
      if (shelved) shelfRow.append(...its.filter(isShort).map(short));
      else {
        const inGrid = [...gridEl.querySelectorAll('.xvt-card[data-id]')].filter((c) => isShort(S.items.get(c.dataset.id)));
        if (inGrid.length >= SHELF_MIN) {
          for (const c of inGrid) { shelfRow.append(short(S.items.get(c.dataset.id))); c.remove(); }
          shelf.hidden = false;
        }
      }
      if (revealGrid && its.length) { const show = revealGrid; revealGrid = null; show(gridEl); }
    }

    // Nothing for this feed after a while: fall back to every video saved
    // from other feeds, and say so. Only an empty store gets the empty state.
    function armEmpty() {
      clearTimeout(emptyTimer);
      emptyTimer = setTimeout(() => {
        if (view !== 'grid' || feed(S.feed).ids.length) return;
        const def = feedDef(S.feed);
        const fallback = pool(S.feed);
        const retry = h('button', { type: 'button', class: 'xvt-link', onclick: () => { const fe = feed(S.feed); fe.frame?.remove(); fe.frame = null; fe.retried = false; fe.ended = false; render(); } }, 'Try again');
        if (fallback.length) {
          noticeEl.replaceChildren(notice(`X didn’t return any ${def.label} videos. Showing videos you’ve seen before.`, retry));
          addToGrid(fallback.slice(0, 60));
          return;
        }
        const empty = h('div', { class: 'xvt-empty' },
          h('p', { class: 'xvt-empty-h' }, 'No videos here yet'),
          h('p', null, def.id === 'foryou' ? 'Your home timeline had no videos in its first pages.' : `X returned no videos for “${def.label}”.`),
          retry);
        if (revealGrid) { const show = revealGrid; revealGrid = null; show(empty); } else gridEl.replaceChildren(empty);
      }, 12000);
    }

    function onEnd(id) {
      if (id !== S.feed || view !== 'grid' || !sentinel) return;
      sentinel.replaceChildren(h('p', { class: 'xvt-end' }, feed(id).live ? 'That’s everything X returned for this feed.' : ''));
      if (!feed(id).ids.length) armEmpty();
    }

    // `replacesSaved`: the first live posts for a feed that was showing saved
    // ones. Redraw with live first unless you've already scrolled into it.
    function onItems(ids, replacesSaved) {
      if (view === 'grid' && gridEl) {
        if (replacesSaved && body.scrollTop < 400) { render(); return; }
        noticeEl?.replaceChildren();
        gridEl.querySelectorAll('.xvt-empty').forEach((n) => n.remove());
        addToGrid(ids);
        clearTimeout(emptyTimer);
      } else if (view === 'watch') watch?.refresh();
      else if (view === 'reels') reels?.append(ids);
    }

    // ----- player -----

    // The custom player: X-style controls over a bare <video>, the fallback
    // chain from playback(), double-tap to like, and theatre/fullscreen.
    function Player(it, { onNext, onLike, onTheater } = {}) {
      const video = h('video', { class: 'xvt-video', playsinline: true, autoplay: true, poster: thumb(it, 'large'), disablepictureinpicture: false });
      video.volume = S.volume;
      video.muted = S.muted;
      const frame = h('div', { class: 'xvt-player', style: `--ar:${Math.max(it.ar, 0.5625)}` }, video);
      const pb = playback(video, it, frame, { box: 720 });

      const flash = h('div', { class: 'xvt-flash' });
      const burst = h('div', { class: 'xvt-burst', 'aria-hidden': 'true' }, icon('heartf'));

      // scrubber
      const buf = h('i', { class: 'xvt-buf' }), played = h('i', { class: 'xvt-played' }), knob = h('i', { class: 'xvt-knob' });
      const tip = h('span', { class: 'xvt-tip' });
      const track = h('div', { class: 'xvt-track' }, buf, played, knob);
      const scrub = h('div', { class: 'xvt-scrub', role: 'slider', tabindex: '0', 'aria-label': 'Seek', 'aria-valuemin': '0' }, track, tip);

      const btn = (name, label, fn, cls = '') => h('button', { type: 'button', class: 'xvt-cbtn ' + cls, 'aria-label': label, title: label, onclick: (e) => { e.stopPropagation(); fn(e); } }, icon(name));
      const playBtn = btn('play', 'Play (K)', () => (video.paused ? video.play().catch(() => {}) : video.pause()));
      const muteBtn = btn(S.muted ? 'mute' : 'sound', 'Mute (M)', () => { video.muted = !video.muted; if (!video.muted && !video.volume) video.volume = 0.5; });
      const vol = h('input', { type: 'range', class: 'xvt-vol', min: '0', max: '1', step: '0.05', value: String(S.muted ? 0 : S.volume), 'aria-label': 'Volume',
        oninput: (e) => { video.volume = +e.target.value; video.muted = video.volume === 0; }, onclick: (e) => e.stopPropagation() });
      const time = h('span', { class: 'xvt-time' }, '0:00 / ' + clock(it.duration));

      // quality menu
      const qBtnLabel = () => (S.maxH ? S.maxH + 'p' : 'Auto');
      const qLabel = h('span', { class: 'xvt-qlabel' }, qBtnLabel());
      const menu = h('div', { class: 'xvt-menu', role: 'menu', hidden: true, onclick: (e) => e.stopPropagation() });
      function fillMenu() {
        const opts = [[0, 'Auto'], ...qualities(it).map((q) => [q, q + 'p'])];
        menu.replaceChildren(h('div', { class: 'xvt-menu-h' }, 'Quality'), ...opts.map(([v, label]) => h('button', {
          type: 'button', role: 'menuitemradio', 'aria-checked': String(S.maxH === v), class: 'xvt-mitem',
          onclick: () => { S.maxH = v; store.set('maxH', v); pb.setQuality(); qLabel.textContent = qBtnLabel(); menu.hidden = true; },
        }, h('span', null, label), S.maxH === v ? icon('check') : null)));
      }
      const qBtn = h('button', { type: 'button', class: 'xvt-cbtn xvt-qbtn', 'aria-label': 'Quality', 'aria-haspopup': 'menu', onclick: (e) => { e.stopPropagation(); fillMenu(); menu.hidden = !menu.hidden; } }, icon('gear'), qLabel);
      const theaterBtn = onTheater ? btn('theater', 'Theatre mode (T)', () => onTheater()) : null;
      const pipBtn = document.pictureInPictureEnabled ? btn('pip', 'Picture in picture', () => (document.pictureInPictureElement ? document.exitPictureInPicture() : video.requestPictureInPicture()).catch(() => {})) : null;
      const fullBtn = btn('full', 'Full screen (F)', () => fullscreen());
      const nextBtn = onNext ? btn('next', 'Next (Shift+N)', () => onNext()) : null;

      const bar = h('div', { class: 'xvt-controls', onclick: (e) => e.stopPropagation() },
        scrub,
        h('div', { class: 'xvt-crow' }, playBtn, nextBtn, h('div', { class: 'xvt-volwrap' }, muteBtn, vol), time,
          h('span', { class: 'xvt-grow' }), h('div', { class: 'xvt-qwrap' }, qBtn, menu), theaterBtn, pipBtn, fullBtn));
      frame.append(flash, burst, bar);

      function fullscreen() {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else frame.requestFullscreen?.().catch(() => {});
      }
      const onFs = () => { const on = document.fullscreenElement === frame; frame.classList.toggle('xvt-fs', on); fullBtn.replaceChildren(icon(on ? 'unfull' : 'full')); };
      document.addEventListener('fullscreenchange', onFs);

      function pop(name) {
        flash.replaceChildren(icon(name));
        flash.classList.remove('xvt-pop'); void flash.offsetWidth; flash.classList.add('xvt-pop');
      }
      function heart() {
        burst.classList.remove('xvt-pop'); void burst.offsetWidth; burst.classList.add('xvt-pop');
        onLike?.();
      }

      // One tap toggles play; a second within 260ms is a like instead.
      let tapT = 0;
      frame.addEventListener('click', () => {
        if (!menu.hidden) { menu.hidden = true; return; }
        if (tapT) { clearTimeout(tapT); tapT = 0; heart(); return; }
        tapT = setTimeout(() => { tapT = 0; video.paused ? video.play().catch(() => {}) : video.pause(); pop(video.paused ? 'pause' : 'play'); }, 260);
      });

      // controls hide while playing and the pointer is still
      let idle = 0;
      const wake = () => { frame.classList.remove('xvt-idle'); clearTimeout(idle); idle = setTimeout(() => { if (!video.paused && menu.hidden) frame.classList.add('xvt-idle'); }, 2400); };
      frame.addEventListener('pointermove', wake);
      frame.addEventListener('pointerleave', () => { if (!video.paused) frame.classList.add('xvt-idle'); });

      const sync = () => {
        const d = video.duration || it.duration / 1000 || 0;
        const p = d ? video.currentTime / d : 0;
        played.style.transform = `scaleX(${p})`;
        knob.style.left = p * 100 + '%';
        time.textContent = `${clock(video.currentTime * 1000)} / ${clock(d * 1000)}`;
        scrub.setAttribute('aria-valuemax', String(Math.round(d)));
        scrub.setAttribute('aria-valuenow', String(Math.round(video.currentTime)));
        const b = video.buffered;
        if (b.length && d) buf.style.transform = `scaleX(${b.end(b.length - 1) / d})`;
      };
      video.addEventListener('timeupdate', sync);
      video.addEventListener('progress', sync);
      video.addEventListener('loadedmetadata', sync);
      video.addEventListener('play', () => { playBtn.replaceChildren(icon('pause')); playBtn.setAttribute('aria-label', 'Pause (K)'); frame.classList.remove('xvt-paused'); wake(); });
      video.addEventListener('pause', () => { playBtn.replaceChildren(icon('play')); playBtn.setAttribute('aria-label', 'Play (K)'); frame.classList.add('xvt-paused'); frame.classList.remove('xvt-idle'); });
      video.addEventListener('volumechange', () => {
        S.muted = video.muted; S.volume = video.volume || S.volume;
        store.set('muted', S.muted); store.set('volume', S.volume);
        muteBtn.replaceChildren(icon(video.muted || !video.volume ? 'mute' : 'sound'));
        vol.value = String(video.muted ? 0 : video.volume);
      });

      // seeking
      const at = (e) => { const r = track.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
      let drag = false;
      scrub.addEventListener('pointermove', (e) => {
        const d = video.duration || it.duration / 1000;
        const p = at(e);
        tip.textContent = clock(p * d * 1000);
        tip.style.left = p * 100 + '%';
        if (drag && video.duration) video.currentTime = p * video.duration;
      });
      scrub.addEventListener('pointerdown', (e) => { e.stopPropagation(); drag = true; scrub.setPointerCapture(e.pointerId); frame.classList.add('xvt-seeking'); if (video.duration) video.currentTime = at(e) * video.duration; });
      scrub.addEventListener('pointerup', () => { drag = false; frame.classList.remove('xvt-seeking'); });
      scrub.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); video.currentTime += e.key === 'ArrowLeft' ? -5 : 5; }
      });

      pb.start();
      video.play().catch(() => { video.muted = true; video.play().catch(() => {}); });

      return {
        el: frame, video, pb, fullscreen, heart, pop,
        destroy() { pb.stop(); clearTimeout(idle); document.removeEventListener('fullscreenchange', onFs); video.pause(); video.removeAttribute('src'); video.load(); },
      };
    }

    // ----- actions and replies -----

    // Like / repost / bookmark / reply buttons bound to a thread. `compact`
    // is the reels rail: icon over count.
    function Actions(it, T, { compact, onReply } = {}) {
      const defs = [
        { key: 'liked', count: 'likes', icon: 'heart', on: 'heartf', label: 'Like', cls: 'xvt-like' },
        { key: 'reposted', count: 'reposts', icon: 'repost', on: 'repost', label: 'Repost', cls: 'xvt-repost' },
        { key: 'reply', count: 'replies', icon: 'reply', label: 'Reply', cls: 'xvt-replyb' },
        { key: 'bookmarked', count: 'bookmarks', icon: 'bookmark', on: 'bookmarkf', label: 'Bookmark', cls: 'xvt-mark' },
      ];
      const btns = defs.map((d) => {
        const n = h('span', { class: 'xvt-n' });
        const b = h('button', { type: 'button', class: (compact ? 'xvt-rstat ' : 'xvt-act ') + d.cls, 'aria-label': d.label,
          onclick: (e) => { e.stopPropagation(); if (d.key === 'reply') onReply ? onReply() : replyIntent(it); else act(T, d.key); } },
          compact ? h('span', { class: 'xvt-round' }) : h('span', { class: 'xvt-ico' }), n);
        return { d, b, n };
      });
      function paint() {
        const s = T.state || {};
        for (const { d, b, n } of btns) {
          const on = d.key !== 'reply' && !!s[d.key];
          b.classList.toggle('xvt-on', on);
          b.setAttribute('aria-pressed', d.key === 'reply' ? null : String(on));
          if (d.key === 'reply') b.removeAttribute('aria-pressed');
          const holder = b.firstChild;
          holder.replaceChildren(icon(on && d.on ? d.on : d.icon));
          const v = s[d.count] ?? it[d.count];
          n.textContent = v ? count(v) : compact ? d.label : '';
        }
      }
      paint();
      const off = T.on(paint);
      return { el: h('div', { class: compact ? 'xvt-rail-acts' : 'xvt-acts' }, btns.map((x) => x.b)), destroy: off };
    }

    function replyRow(r) {
      if (r.sample) {
        return h('div', { class: 'xvt-reply' }, h('span', { class: 'xvt-ava' }),
          h('div', { class: 'xvt-lines' }, h('div', { class: 'xvt-rhead' }, h('b', null, 'Sample name'), h('span', { class: 'xvt-sub' }, '@sample · 2h')),
            h('p', { class: 'xvt-rtext' }, 'A sample reply that is long enough to wrap onto a second line of text')));
      }
      return h('article', { class: 'xvt-reply' },
        h('a', { href: '/' + r.author.handle }, h('img', { class: 'xvt-ava', src: r.author.avatar, alt: '', loading: 'lazy' })),
        h('div', { class: 'xvt-lines' },
          h('div', { class: 'xvt-rhead' },
            h('a', { href: '/' + r.author.handle }, h('b', null, r.author.name)),
            h('span', { class: 'xvt-sub' }, `@${r.author.handle} · ${ago(r.created)}`)),
          r.text ? h('p', { class: 'xvt-rtext' }, linkify(r.text)) : null,
          r.media ? h('a', { class: 'xvt-rmedia', href: `/${r.author.handle}/status/${r.id}`, style: `--ar:${Math.min(Math.max(r.media.ar, 0.75), 1.9)}` }, h('img', { src: r.media.url + '?name=small', alt: '', loading: 'lazy' })) : null,
          h('div', { class: 'xvt-rfoot' },
            h('span', null, icon('heart'), r.likes ? count(r.likes) : ''),
            h('span', null, icon('reply'), r.replies ? count(r.replies) : ''),
            h('a', { href: `/${r.author.handle}/status/${r.id}` }, 'Open'))),
      );
    }

    // The replies section: a composer, the replies X returned, and more on
    // request. Skeleton while the thread frame loads; a way out if it fails.
    function Replies(it, T) {
      const list = h('div', { class: 'xvt-rlist' });
      const moreBtn = h('button', { type: 'button', class: 'xvt-btn xvt-rmore', hidden: true, onclick: () => { moreBtn.disabled = true; moreBtn.textContent = 'Loading…'; T.loadMore(); } }, 'Show more replies');
      const user = me();
      const input = h('textarea', { class: 'xvt-compose', rows: '1', placeholder: 'Post your reply', 'aria-label': 'Post your reply', maxlength: '280',
        oninput: () => { input.style.height = 'auto'; input.style.height = input.scrollHeight + 'px'; send.disabled = !input.value.trim(); },
        onkeydown: (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send.click(); } } });
      const send = h('button', { type: 'button', class: 'xvt-btn xvt-btn-primary', disabled: true, onclick: async () => {
        const text = input.value.trim();
        if (!text) return;
        send.disabled = true; send.textContent = 'Replying…';
        const ok = await sendReply(T, text);
        send.textContent = 'Reply';
        if (ok) {
          T.replies.unshift({ id: 'local-' + Date.now(), text, author: { name: 'You', handle: user.handle, avatar: user.avatar }, created: Date.now(), likes: 0, replies: 0 });
          input.value = ''; input.style.height = '';
          T.emit();
          UI.toast('Reply posted');
        } else {
          send.disabled = false;
          UI.toast('X’s reply box didn’t respond here. Opening X’s composer instead.');
          replyIntent(it);
        }
      } }, 'Reply');
      const composer = h('div', { class: 'xvt-composer' },
        user.avatar ? h('img', { class: 'xvt-ava', src: user.avatar, alt: '' }) : h('span', { class: 'xvt-ava' }),
        input, send);

      let show = skeletonIn(list, h('div', { class: 'xvt-rlist-inner' }, Array.from({ length: 4 }, () => replyRow({ sample: true }))), 'replies', 'Loading replies');
      function paint() {
        let body;
        if (T.replies.length) body = h('div', { class: 'xvt-rlist-inner' }, T.replies.map(replyRow));
        else if (T.state || T.failed) {
          const hidden = !T.failed && (T.state?.replies || it.replies) > 0;
          body = h('div', { class: 'xvt-rempty' },
            T.failed ? 'Replies didn’t load. ' : hidden ? 'X is only showing these replies on the post itself. ' : 'No replies yet. ',
            h('a', { href: postUrl(it), class: 'xvt-inline' }, T.failed || hidden ? 'Open the post on X' : 'Be the first'));
        } else return;
        if (show) { const s = show; show = null; s(body); } else list.replaceChildren(body);
        moreBtn.hidden = !T.more || !T.replies.length;
        moreBtn.disabled = false; moreBtn.textContent = 'Show more replies';
      }
      const off = T.on(paint);
      paint();
      const head = h('div', { class: 'xvt-rsec-head' }, h('b', null, 'Replies'), h('span', { class: 'xvt-sub' }, it.replies ? count(it.replies) : ''));
      const el = h('section', { class: 'xvt-replies', 'aria-label': 'Replies' }, head, composer, list, moreBtn);
      return { el, focus: () => input.focus(), destroy: off };
    }

    // ----- watch -----

    function Watch(id) {
      const it = S.items.get(id);
      if (!it) {
        // Opened from a link before the post loaded: show grid instead.
        setTimeout(() => go({ mode: 'grid' }, true));
        return { el: h('div'), destroy() {}, refresh() {} };
      }
      const T = getThread(it);
      let theater = store.get('theater', false);
      const P = Player(it, {
        onNext: () => { const n = upNext()[0]; if (n) go({ v: n.id }); },
        onLike: () => act(T, 'liked', true),
        onTheater: () => setTheater(!theater),
      });
      const video = P.video;
      const resume = progress[id]?.[0];
      if (resume) video.addEventListener('loadedmetadata', () => { video.currentTime = resume; }, { once: true });
      video.addEventListener('timeupdate', () => saveProgress(id, video.currentTime, video.duration));
      video.addEventListener('ended', () => { if (S.autoplay) { const n = upNext()[0]; if (n) go({ v: n.id }); } });

      const acts = Actions(it, T, { onReply: () => R.focus() });
      const R = Replies(it, T);

      let copied = 0;
      const copyBtn = h('button', { type: 'button', class: 'xvt-act', 'aria-label': 'Copy link', onclick: async () => {
        try { await navigator.clipboard.writeText('https://x.com' + postUrl(it)); } catch {}
        UI.toast('Link copied');
        clearTimeout(copied);
      } }, h('span', { class: 'xvt-ico' }, icon('link')));

      const autoBtn = h('button', { type: 'button', role: 'switch', class: 'xvt-switch', 'aria-checked': String(S.autoplay), onclick: () => { S.autoplay = !S.autoplay; store.set('autoplay', S.autoplay); autoBtn.setAttribute('aria-checked', String(S.autoplay)); } }, h('span', null, 'Autoplay'), h('i'));

      const list = h('div', { class: 'xvt-next-list' });
      function upNext() {
        const ids = feed(S.feed).ids;
        const i = ids.indexOf(id);
        const order = i >= 0 ? ids.slice(i + 1).concat(ids.slice(0, i)) : ids.filter((x) => x !== id);
        return order.map((x) => S.items.get(x)).filter(valid).slice(0, 24);
      }
      let revealList = null;
      function refresh() {
        const next = upNext();
        if (!next.length) {
          if (!revealList) revealList = skeletonIn(list, h('div', { class: 'xvt-next-inner' }, Array.from({ length: 6 }, () => nextRow(SAMPLE))), 'next', 'Loading up next');
          more(S.feed);
          return;
        }
        const inner = h('div', { class: 'xvt-next-inner' }, next.map(nextRow));
        if (revealList) { const show = revealList; revealList = null; show(inner); } else list.replaceChildren(inner);
        if (next.length < 6) more(S.feed);
      }
      function nextRow(n) {
        if (n.sample) {
          return h('div', { class: 'xvt-next' }, h('div', { class: 'xvt-thumb' }),
            h('div', { class: 'xvt-lines' }, h('div', { class: 'xvt-title' }, n.text), h('div', { class: 'xvt-sub' }, n.author.name), h('div', { class: 'xvt-sub' }, '12K views · 1 hour ago')));
        }
        return h('a', { class: 'xvt-next', href: postUrl(n), onclick: (e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); go({ v: n.id }); } },
          h('div', { class: 'xvt-thumb' + (n.ar < 1.45 ? ' xvt-tall' : '') },
            n.ar < 1.45 ? h('img', { class: 'xvt-blur', src: thumb(n, 'thumb'), alt: '', loading: 'lazy' }) : null,
            h('img', { class: 'xvt-poster', src: thumb(n), alt: '', loading: 'lazy' }),
            h('span', { class: 'xvt-dur' }, clock(n.duration)),
            watchedBar(n.id)),
          h('div', { class: 'xvt-lines' },
            h('div', { class: 'xvt-title' }, title(n)),
            h('div', { class: 'xvt-sub' }, n.author.name),
            h('div', { class: 'xvt-sub' }, `${count(n.views)} views · ${ago(n.created)}`)),
        );
      }
      refresh();

      const date = new Date(it.created).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
      let open = false;
      const desc = it.text ? h('p', { class: 'xvt-dtext' }, linkify(it.text)) : null;
      const descBox = h('div', { class: 'xvt-desc', onclick: (e) => { if (e.target.closest('a')) return; open = !open; descBox.classList.toggle('xvt-open', open); } },
        h('b', null, `${count(it.views)} views · ${date}`), desc);

      const stage = h('div', { class: 'xvt-stage' }, P.el);
      const el = h('div', { class: 'xvt-watch' },
        h('div', { class: 'xvt-wtop' },
          h('button', { type: 'button', class: 'xvt-back', onclick: () => (history.state?.xvt ? history.back() : go({ mode: 'grid' })) }, icon('back'), h('span', null, 'Videos'))),
        stage,
        h('div', { class: 'xvt-main' },
          h('h2', { class: 'xvt-wtitle' }, title(it)),
          h('div', { class: 'xvt-row' },
            h('a', { class: 'xvt-author', href: '/' + it.author.handle },
              h('img', { class: 'xvt-ava', src: it.author.avatar, alt: '' }),
              h('span', { class: 'xvt-lines' }, h('b', null, it.author.name), h('span', { class: 'xvt-sub' }, '@' + it.author.handle))),
            h('div', { class: 'xvt-actions' }, acts.el, copyBtn,
              h('a', { class: 'xvt-btn xvt-btn-primary', href: postUrl(it) }, icon('open'), h('span', null, 'Open on X')))),
          descBox,
          R.el),
        h('aside', { class: 'xvt-side', 'aria-label': 'Up next' },
          h('div', { class: 'xvt-side-head' }, h('b', null, 'Up next'), autoBtn),
          list),
      );
      function setTheater(on) {
        theater = on;
        store.set('theater', on);
        el.classList.toggle('xvt-theater', on);
      }
      setTheater(theater);
      return {
        el, refresh, video, player: P, theater: () => setTheater(!theater), like: () => { P.heart(); },
        destroy() { P.destroy(); acts.destroy(); R.destroy(); },
      };
    }

    // ----- reels -----

    function Reels(startId) {
      const ids = feed(S.feed).ids;
      const scroller = h('div', { class: 'xvt-reels', tabindex: '-1' });
      const slides = new Map(); // id -> { el, video, it }
      let active = null, hint = null;

      function slide(it) {
        const video = h('video', { class: 'xvt-rvideo', playsinline: true, loop: true, preload: 'none', disablepictureinpicture: true });
        const bar = h('div', { class: 'xvt-progress' }, h('i'));
        const flash = h('div', { class: 'xvt-flash' });
        const muteBtn = h('button', { type: 'button', class: 'xvt-round xvt-mute', 'aria-label': S.muted ? 'Unmute' : 'Mute', onclick: (e) => { e.stopPropagation(); setMuted(!S.muted); } }, icon(S.muted ? 'mute' : 'sound'));
        let expanded = false;
        const cap = it.text ? h('p', { class: 'xvt-cap', onclick: (e) => { e.stopPropagation(); expanded = !expanded; cap.classList.toggle('xvt-open', expanded); } }, it.text) : null;
        const burst = h('div', { class: 'xvt-burst', 'aria-hidden': 'true' }, icon('heartf'));
        // One tap pauses; a second within 260ms likes instead (and never unlikes).
        let tapT = 0;
        const card = h('div', { class: 'xvt-rcard', style: `--ar:${Math.min(Math.max(it.ar, 0.5625), 1.78)}`, onclick: () => {
          if (tapT) { clearTimeout(tapT); tapT = 0; like(s); return; }
          tapT = setTimeout(() => { tapT = 0; toggle(s); }, 260);
        } },
          h('img', { class: 'xvt-rblur', src: thumb(it, 'small'), alt: '' }),
          h('img', { class: 'xvt-rposter', src: thumb(it, 'medium'), alt: '' }),
          video, flash, burst, muteBtn,
          h('div', { class: 'xvt-rinfo' },
            h('a', { class: 'xvt-author', href: '/' + it.author.handle, onclick: (e) => e.stopPropagation() },
              h('img', { class: 'xvt-ava', src: it.author.avatar, alt: '' }),
              h('b', null, it.author.name || it.author.handle), h('span', { class: 'xvt-sub' }, '@' + it.author.handle)),
            cap),
          bar,
        );
        bar.addEventListener('click', (e) => {
          e.stopPropagation();
          const r = bar.getBoundingClientRect();
          if (video.duration) video.currentTime = ((e.clientX - r.left) / r.width) * video.duration;
        });
        video.addEventListener('timeupdate', () => {
          if (!video.duration) return;
          bar.firstChild.style.transform = `scaleX(${video.currentTime / video.duration})`;
          saveProgress(it.id, video.currentTime, video.duration);
        });
        video.addEventListener('playing', () => card.classList.add('xvt-live'));
        const pb = playback(video, it, card, { box: 800 });
        const T = getThread(it, { lazy: true });
        const acts = Actions(it, T, { compact: true, onReply: () => openSheet(s) });
        const el = h('section', { class: 'xvt-slide', 'data-id': it.id, 'aria-label': title(it) },
          card,
          h('div', { class: 'xvt-rail' },
            acts.el,
            h('a', { class: 'xvt-rstat', href: postUrl(it), title: 'Open on X', onclick: (e) => e.stopPropagation() }, h('span', { class: 'xvt-round' }, icon('open')), 'Open'),
          ),
        );
        const s = { el, video, it, card, flash, burst, muteBtn, pb, T, acts };
        slides.set(it.id, s);
        return el;
      }

      function setMuted(m) {
        S.muted = m;
        store.set('muted', m);
        for (const s of slides.values()) {
          s.video.muted = m;
          s.muteBtn.setAttribute('aria-label', m ? 'Unmute' : 'Mute');
          s.muteBtn.replaceChildren(icon(m ? 'mute' : 'sound'));
        }
        hint?.remove(); hint = null;
      }

      function like(s) {
        s.burst.classList.remove('xvt-pop'); void s.burst.offsetWidth; s.burst.classList.add('xvt-pop');
        act(s.T, 'liked', true);
      }

      // Replies for the active reel, in a sheet beside it.
      let sheet = null;
      function openSheet(s) {
        closeSheet();
        s.T.wake();
        const R = Replies(s.it, s.T);
        const panel = h('aside', { class: 'xvt-sheet', role: 'dialog', 'aria-label': 'Replies' },
          h('button', { type: 'button', class: 'xvt-round xvt-sheet-x', 'aria-label': 'Close replies', onclick: closeSheet }, icon('close')),
          R.el);
        wrap.append(panel);
        wrap.classList.add('xvt-sheet-open');
        sheet = { panel, R, id: s.it.id };
      }
      function closeSheet() {
        if (!sheet) return;
        sheet.R.destroy();
        sheet.panel.remove();
        wrap.classList.remove('xvt-sheet-open');
        sheet = null;
      }

      function toggle(s) {
        if (s.video.paused) s.video.play().catch(() => {}); else s.video.pause();
        s.flash.replaceChildren(icon(s.video.paused ? 'pause' : 'play'));
        s.flash.classList.remove('xvt-pop');
        void s.flash.offsetWidth;
        s.flash.classList.add('xvt-pop');
      }

      // Only the active slide and its neighbours hold a source.
      function load(id, on) {
        const s = slides.get(id);
        if (!s) return;
        if (on && !s.video.getAttribute('src')) { s.video.preload = 'auto'; s.pb.start(); }
        if (!on && s.video.getAttribute('src')) { s.pb.stop(); s.video.pause(); s.video.removeAttribute('src'); s.video.load(); s.card.classList.remove('xvt-live'); }
      }

      function activate(id) {
        if (active === id) return;
        const prev = slides.get(active);
        prev?.video.pause();
        active = id;
        current = id;
        const order = feed(S.feed).ids;
        const i = order.indexOf(id);
        for (const [sid] of slides) { const j = order.indexOf(sid); load(sid, Math.abs(j - i) <= 1); }
        const s = slides.get(id);
        s.video.muted = S.muted;
        s.video.volume = S.volume;
        s.video.currentTime = 0;
        s.video.play().catch(() => {
          s.video.muted = true;
          s.video.play().catch(() => {});
          if (!S.muted && !hint) {
            hint = h('button', { type: 'button', class: 'xvt-hint', onclick: (e) => { e.stopPropagation(); setMuted(false); s.video.muted = false; } }, icon('sound'), 'Tap for sound');
            s.card.append(hint);
          }
        });
        history.replaceState({ xvt: 1 }, '', `${ROUTE}?mode=reels&v=${id}`);
        lastHref = location.href;
        if (order.length - i < 4) more(S.feed);
        // Linger on a reel and its X page loads, so the rail shows whether you've liked it.
        clearTimeout(dwell);
        dwell = setTimeout(() => { if (active === id) s.T.wake(); }, 1200);
        if (sheet && sheet.id !== id) openSheet(s);
      }
      let dwell = 0;

      const vis = new IntersectionObserver((es) => {
        for (const e of es) if (e.isIntersecting && e.intersectionRatio > 0.6) activate(e.target.dataset.id);
      }, { root: scroller, threshold: [0.6] });

      function append(newIds) {
        for (const id of newIds) {
          const it = S.items.get(id);
          if (!it || slides.has(id)) continue;
          const el = slide(it);
          scroller.insertBefore(el, tail);
          vis.observe(el);
        }
        if (slides.size) tail.replaceChildren();
      }

      function step(d) {
        const order = [...slides.keys()];
        const i = order.indexOf(active);
        const n = order[Math.min(order.length - 1, Math.max(0, i + d))];
        slides.get(n)?.el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }

      function jump(id) { slides.get(id)?.el.scrollIntoView(); }

      const tail = h('div', { class: 'xvt-slide xvt-rload' }, h('div', { class: 'xvt-rcard xvt-skel' }));
      scroller.append(tail);
      append(ids);
      const fallback = ids.length ? 0 : setTimeout(() => { if (!slides.size) append(pool(S.feed).slice(0, 60)); }, 12000);

      const nav = h('div', { class: 'xvt-rnav' },
        h('button', { type: 'button', class: 'xvt-round', 'aria-label': 'Previous (K)', onclick: () => step(-1) }, icon('up')),
        h('button', { type: 'button', class: 'xvt-round', 'aria-label': 'Next (J)', onclick: () => step(1) }, icon('down')));

      const wrap = h('div', { class: 'xvt-reelwrap' }, scroller, nav);
      requestAnimationFrame(() => {
        if (startId && slides.has(startId)) jump(startId);
        scroller.focus({ preventScroll: true });
      });
      return {
        el: wrap, append, jump, step, toggle: () => slides.get(active) && toggle(slides.get(active)), mute: () => setMuted(!S.muted),
        like: () => slides.get(active) && like(slides.get(active)),
        replies: () => { const s = slides.get(active); if (!s) return; sheet ? closeSheet() : openSheet(s); },
        closeSheet: () => (sheet ? (closeSheet(), true) : false),
        destroy() { clearTimeout(fallback); clearTimeout(dwell); closeSheet(); vis.disconnect(); for (const [id, s] of slides) { s.acts.destroy(); load(id, false); } },
      };
    }

    // ----- keyboard -----

    addEventListener('keydown', (e) => {
      if (!view || root.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      const k = e.key;
      if (view === 'reels') {
        if (k === 'ArrowDown' || k === 'j') { e.preventDefault(); reels.step(1); }
        else if (k === 'ArrowUp' || k === 'k') { e.preventDefault(); reels.step(-1); }
        else if (k === ' ') { e.preventDefault(); reels.toggle(); }
        else if (k === 'm') reels.mute();
        else if (k === 'h') reels.like();
        else if (k === 'c') reels.replies();
        else if (k === 'Escape') { if (!reels.closeSheet()) go({ mode: 'grid' }); }
        else if (k === 'g') go({ mode: 'grid' });
      } else if (view === 'watch') {
        const v = watch?.video;
        if (!v) return;
        if (t.closest?.('.xvt-scrub')) return; // the scrubber handles its own arrows
        if (k === ' ' || k === 'k') { e.preventDefault(); v.paused ? v.play().catch(() => {}) : v.pause(); watch.player.pop(v.paused ? 'pause' : 'play'); }
        else if (k === 'j' || k === 'ArrowLeft') { e.preventDefault(); v.currentTime -= k === 'j' ? 10 : 5; }
        else if (k === 'l' || k === 'ArrowRight') { e.preventDefault(); v.currentTime += k === 'l' ? 10 : 5; }
        else if (k === 'm') v.muted = !v.muted;
        else if (k === 'f') watch.player.fullscreen();
        else if (k === 't') watch.theater();
        else if (k === 'h') watch.player.heart();
        else if (k === 'N') { const n = el$('.xvt-next'); n?.click(); }
        else if (k === 'Escape' && !document.fullscreenElement) go({ mode: 'grid' });
        else if (k === 'r') go({ mode: 'reels', v: current });
      } else if (view === 'grid') {
        if (k === 'r') go({ mode: 'reels' });
        else if (k === '/') { e.preventDefault(); head.querySelector('input').focus(); }
      }
    });
    const el$ = (s) => root.querySelector(s);

    let toastEl = null, toastT = 0;
    function toast(text) {
      if (!root) return;
      if (!toastEl) { toastEl = h('div', { class: 'xvt-toast', role: 'status', 'aria-live': 'polite' }); root.append(toastEl); }
      toastEl.textContent = text;
      toastEl.classList.add('xvt-on');
      clearTimeout(toastT);
      toastT = setTimeout(() => toastEl.classList.remove('xvt-on'), 3200);
    }

    return { show, hide, place, onItems, onEnd, toast };
  })();

  // ---------- dev: page snapshots for the launch film ----------
  //
  // With localStorage xvt:dev = 1, window.postMessage({ __xvt: 'capture',
  // name }) serializes the page as it is drawn (X's DOM and this extension's)
  // plus where each named control sits, and sends it to the local capture
  // server. Off for everyone else.
  const CAPTURE_TARGETS = {
    navVideos: '[data-testid="AppTabBar_Videos_Link"]',
    navHome: '[data-testid="AppTabBar_Home_Link"]',
    root: '#xvt-root',
    search: '.xvt-search',
    segGrid: '.xvt-seg [data-mode="grid"]',
    segReels: '.xvt-seg [data-mode="reels"]',
    chips: '.xvt-chips',
    grid: '.xvt-grid',
    cards: '.xvt-card[data-id]',
    shorts: '.xvt-short',
    player: '.xvt-player',
    playerVideo: '.xvt-video',
    theaterBtn: '.xvt-cbtn[aria-label^="Theatre"]',
    acts: '.xvt-acts .xvt-act',
    like: '.xvt-acts .xvt-like',
    replies: '.xvt-replies',
    nextRows: '.xvt-next',
    reelCard: '.xvt-slide .xvt-rcard',
    rail: '.xvt-rail',
    railLike: '.xvt-rail .xvt-like',
    suggest: '.xvt-srow',
    tweets: 'article[data-testid="tweet"]',
    tweetVideos: 'article[data-testid="tweet"] [data-testid="videoPlayer"]',
  };

  function rectsOf() {
    const out = {};
    for (const [k, sel] of Object.entries(CAPTURE_TARGETS)) {
      const els = [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length);
      const list = els.slice(0, 40).map((e) => {
        const r = e.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), id: e.dataset?.id || e.closest('[data-id]')?.dataset.id || null };
      }).filter((r) => r.w && r.h);
      if (list.length) out[k] = list;
    }
    return out;
  }

  function snapshot() {
    const css = [];
    for (const sh of document.styleSheets) {
      try { css.push([...sh.cssRules].map((r) => r.cssText).join('\n')); }
      catch { if (sh.href) css.push(`@import url("${sh.href}");`); }
    }
    // values and scroll that live in properties, not attributes
    document.querySelectorAll('input, textarea').forEach((el) => el.setAttribute('value', el.value));
    const scrolls = [];
    document.querySelectorAll('*').forEach((el) => { if (el.scrollTop > 0) scrolls.push([el, el.scrollTop]); });
    scrolls.forEach(([el, t], i) => el.setAttribute('data-xvt-scroll', `${i}:${t}`));
    const videos = [...document.querySelectorAll('video')];
    videos.forEach((v, i) => v.setAttribute('data-xvt-video', String(i)));
    const clone = document.documentElement.cloneNode(true);
    scrolls.forEach(([el]) => el.removeAttribute('data-xvt-scroll'));
    clone.querySelectorAll('script, iframe, noscript, style, link, meta[http-equiv]').forEach((n) => n.remove());
    // a video is drawn as its poster (the film puts the real one on top)
    clone.querySelectorAll('video').forEach((v) => {
      const src = videos[+v.dataset.xvtVideo];
      const img = document.createElement('img');
      img.className = v.className + ' xvt-snap-video';
      img.setAttribute('style', (v.getAttribute('style') || '') + ';object-fit:' + getComputedStyle(src).objectFit);
      img.src = src.poster || '';
      v.replaceWith(img);
    });
    const head = clone.querySelector('head');
    const style = document.createElement('style');
    style.textContent = css.join('\n');
    head.prepend(style);
    return '<!doctype html>\n' + clone.outerHTML;
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.__xvt !== 'capture') return;
    if (store.get('dev', null) !== 1 && localStorage.getItem('xvt:dev') !== '1') return;
    const data = {
      name: String(e.data.name || 'snap').replace(/[^\w-]/g, ''),
      url: location.href,
      viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
      theme: document.getElementById('xvt-root')?.dataset.theme || null,
      rects: rectsOf(),
      scroll: [...document.querySelectorAll('[data-xvt-scroll]')].length,
      html: snapshot(),
    };
    chrome.runtime.sendMessage({ type: 'xvt:capture', data }, (r) => window.postMessage({ __xvt: 'captured', name: data.name, r }, location.origin));
  });

  ensureNav();
  // Saved videos load first (fast, local) so the first paint already has them.
  Promise.race([ready, new Promise((r) => setTimeout(r, 400))]).finally(() => {
    sync();
    setInterval(sync, 250); // X's router changes the URL without telling anyone
  });
})();
