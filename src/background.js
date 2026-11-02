// Dev convenience: opening any x.com URL ending in #xvt-reload reloads the
// unpacked extension, so edits can be picked up without chrome://extensions.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg === 'xvt:reload') chrome.runtime.reload();
  // Dev only (localStorage xvt:dev = 1): hand a page snapshot to the local
  // capture server in build/capture-server.mjs, for the launch film.
  if (msg?.type === 'xvt:capture') {
    fetch('http://127.0.0.1:4700/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(msg.data) })
      .then((r) => r.text()).then((t) => reply({ ok: true, t }), (e) => reply({ ok: false, e: String(e) }));
    return true;
  }
});
