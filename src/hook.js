// Runs in the page's own JS world on every x.com frame, before X's code.
// It reads the GraphQL responses X already fetches, keeps the posts that
// carry a native video, and hands a compact list to app.js in the top frame.
// In a feeder frame (a hidden x.com page app.js opens to fill a feed) it also
// stops X's own players and scrolls on request so X loads the next page.
(() => {
  if (window.__xvtHook) return;
  window.__xvtHook = true;

  // The tab used to live at /i/videos, which is X's bare embed player ("The
  // media could not be played"). Send old links and history entries over.
  if (window.top === window && location.pathname === '/i/videos') {
    location.replace('/i/videotab' + location.search);
    return;
  }

  const FEEDER = window.name.startsWith('xvt:') ? window.name.slice(4) : null;
  const OP = /\/graphql\/[^/]+\/(\w+)/;

  function decode(s) {
    return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }

  function cleanText(t, media) {
    const L = t.legacy;
    const note = t.note_tweet?.note_tweet_results?.result?.text;
    let text = note || L.full_text || '';
    if (!note && L.display_text_range) text = [...text].slice(L.display_text_range[0], L.display_text_range[1]).join('');
    if (media?.url) text = text.split(media.url).join('');
    for (const u of L.entities?.urls || []) text = text.split(u.url).join(u.expanded_url || u.display_url || '');
    return decode(text).replace(/https:\/\/t\.co\/\w+/g, '').trim();
  }

  function toItem(t) {
    const L = t.legacy;
    if (!L || L.retweeted_status_result) return null;
    const m = (L.extended_entities?.media || []).find((x) => x.type === 'video' && x.video_info);
    if (!m || m.ext_media_availability?.status === 'Unavailable') return null;
    const variants = m.video_info.variants
      .filter((v) => v.content_type === 'video/mp4')
      .map((v) => {
        const r = v.url.match(/\/(\d+)x(\d+)\//);
        return { url: v.url, bitrate: v.bitrate || 0, w: r ? +r[1] : 0, h: r ? +r[2] : 0 };
      })
      .sort((a, b) => a.bitrate - b.bitrate);
    if (!variants.length) return null;
    const u = t.core?.user_results?.result || {};
    const uc = u.core || {};
    const ul = u.legacy || {};
    const [aw, ah] = m.video_info.aspect_ratio || [16, 9];
    return {
      id: t.rest_id,
      text: cleanText(t, m),
      author: {
        name: uc.name || ul.name || '',
        handle: uc.screen_name || ul.screen_name || '',
        avatar: (u.avatar?.image_url || ul.profile_image_url_https || '').replace('_normal.', '_bigger.'),
        verified: !!(u.is_blue_verified || u.verification?.verified),
      },
      poster: m.media_url_https,
      ar: aw / ah,
      duration: m.video_info.duration_millis || 0,
      variants,
      views: +(t.views?.count || 0),
      likes: L.favorite_count || 0,
      replies: L.reply_count || 0,
      reposts: L.retweet_count || 0,
      created: Date.parse(L.created_at) || 0,
      sensitive: !!L.possibly_sensitive,
    };
  }

  function extract(root) {
    const out = [];
    const seen = new Set();
    (function walk(o) {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { for (const x of o) walk(x); return; }
      if (o.promotedMetadata) return;
      if (o.__typename === 'TweetWithVisibilityResults' && o.tweet) { walk(o.tweet); return; }
      if (o.__typename === 'Tweet' && o.legacy) {
        const it = toItem(o);
        if (it && !seen.has(it.id)) { seen.add(it.id); out.push(it); }
        walk(o.legacy.retweeted_status_result);
        walk(o.quoted_status_result);
        return;
      }
      for (const k in o) walk(o[k]);
    })(root);
    return out;
  }

  // A thread frame (window.name xvt:thread:<id>) reports the post's own
  // like/repost/bookmark state and its direct replies, not videos.
  function person(u) {
    const uc = u?.core || {}, ul = u?.legacy || {};
    return {
      name: uc.name || ul.name || '',
      handle: uc.screen_name || ul.screen_name || '',
      avatar: (u?.avatar?.image_url || ul.profile_image_url_https || '').replace('_normal.', '_bigger.'),
      verified: !!(u?.is_blue_verified || u?.verification?.verified),
    };
  }

  function thread(root, focal) {
    let state = null;
    const replies = [];
    const seen = new Set();
    let cursor = false;
    (function walk(o, inReplies) {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { for (const x of o) walk(x, inReplies); return; }
      if (o.promotedMetadata) return;
      if (typeof o.entryId === 'string') {
        if (/^cursor-bottom|^cursor-showmore/.test(o.entryId)) cursor = true;
        // A conversation module's first item is the direct reply; the rest
        // are replies to it. Its items carry entryIds of their own.
        if (o.entryId.startsWith('conversationthread-') && Array.isArray(o.content?.items)) {
          walk(o.content.items[0]?.item, true);
          return;
        }
      }
      const t = o.__typename === 'TweetWithVisibilityResults' ? o.tweet : o;
      if (t?.__typename === 'Tweet' && t.legacy) {
        const L = t.legacy;
        if (t.rest_id === focal) {
          state = { liked: !!L.favorited, reposted: !!L.retweeted, bookmarked: !!L.bookmarked, likes: L.favorite_count, reposts: L.retweet_count, replies: L.reply_count, bookmarks: L.bookmark_count };
        } else if (inReplies && !seen.has(t.rest_id)) {
          seen.add(t.rest_id);
          const photo = (L.extended_entities?.media || [])[0];
          replies.push({
            id: t.rest_id,
            text: cleanText(t, photo),
            author: person(t.core?.user_results?.result),
            created: Date.parse(L.created_at) || 0,
            likes: L.favorite_count || 0,
            replies: L.reply_count || 0,
            media: photo ? { type: photo.type, url: photo.media_url_https, ar: (photo.original_info?.width || 1) / (photo.original_info?.height || 1) } : null,
          });
        }
        return;
      }
      for (const k in o) walk(o[k], inReplies);
    })(root, false);
    return { state, replies, more: cursor };
  }

  function deliver(url, text) {
    const op = String(url).match(OP)?.[1];
    if (!op) return;
    if (FEEDER?.startsWith('thread:')) {
      if (op !== 'TweetDetail') return;
      const id = FEEDER.slice(7);
      let t;
      try { t = thread(JSON.parse(text), id); } catch { return; }
      try { window.top.postMessage({ __xvt: 'thread', id, ...t }, location.origin); } catch {}
      return;
    }
    let items;
    try { items = extract(JSON.parse(text)); } catch { return; }
    try {
      window.top.postMessage({ __xvt: 'items', op, feed: FEEDER, items }, location.origin);
    } catch {}
  }

  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, url) {
    this.__xvtUrl = url;
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (OP.test(String(this.__xvtUrl))) {
      this.addEventListener('load', () => {
        if (this.status === 200 && (this.responseType === '' || this.responseType === 'text')) deliver(this.__xvtUrl, this.responseText);
      });
    }
    return send.apply(this, arguments);
  };

  const fetch0 = window.fetch;
  window.fetch = async function (input) {
    const res = await fetch0.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : input?.url;
      if (url && OP.test(url) && res.ok) res.clone().text().then((t) => deliver(url, t), () => {});
    } catch {}
    return res;
  };

  if (!FEEDER) return;

  // Feeder frame: nobody watches this copy of X, so its players never run.
  HTMLMediaElement.prototype.play = function () { this.muted = true; return Promise.resolve(); };
  HTMLMediaElement.prototype.load = function () {};

  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.source !== window.parent || e.data?.__xvt !== 'more') return;
    const el = document.scrollingElement || document.documentElement;
    el.scrollTop = el.scrollHeight;
    window.dispatchEvent(new Event('scroll'));
  });
})();
