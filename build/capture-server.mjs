// Receives page snapshots from the extension's dev capture (see app.js,
// "dev: page snapshots") and writes them, self-contained, for the launch film:
//   <out>/<name>.html   the page, every image, font and stylesheet localized
//   <out>/<name>.json   viewport, theme and where each named control sits
//   node build/capture-server.mjs <out dir>
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

const OUT = resolve(process.argv[2] || 'snapshots')
const MEDIA = join(OUT, 'media')
mkdirSync(MEDIA, { recursive: true })
const EXT = resolve(new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'))
const extCss = ['src/vendor/skullet.css', 'src/app.css'].map((f) => readFileSync(join(EXT, f), 'utf8')).join('\n')

const URL_RE = /https:\/\/(?:pbs|abs|abs-0)\.twimg\.com\/[^"'\s)<>\\]+/g
const cache = new Map()

async function localize(url) {
  const clean = url.replace(/&amp;/g, '&')
  if (cache.has(clean)) return cache.get(clean)
  const p = (async () => {
    const hash = createHash('sha1').update(clean).digest('hex').slice(0, 16)
    let ext = extname(new URL(clean).pathname).slice(0, 6) || ''
    const fmt = new URL(clean).searchParams.get('format')
    if (fmt) ext = '.' + fmt
    const file = hash + (ext || '.bin')
    const path = join(MEDIA, file)
    if (!existsSync(path)) {
      const r = await fetch(clean, { headers: { referer: 'https://x.com/' } })
      if (!r.ok) throw new Error(`${r.status} ${clean}`)
      writeFileSync(path, Buffer.from(await r.arrayBuffer()))
    }
    return 'media/' + file
  })()
  cache.set(clean, p)
  return p
}

async function rewrite(text) {
  const urls = [...new Set(text.match(URL_RE) || [])]
  const map = new Map()
  await Promise.all(urls.map(async (u) => { try { map.set(u, await localize(u)) } catch (e) { console.warn('skip', String(e).slice(0, 120)) } }))
  return text.replace(URL_RE, (u) => map.get(u) || u)
}

async function inlineImports(css) {
  const imports = [...css.matchAll(/@import url\("([^"]+)"\);/g)]
  for (const [all, href] of imports) {
    try { css = css.replace(all, await (await fetch(href)).text()) } catch { css = css.replace(all, '') }
  }
  return css
}

const SCROLL = `<script>document.querySelectorAll('[data-xvt-scroll]').forEach(function(e){e.scrollTop=+e.getAttribute('data-xvt-scroll').split(':')[1]})</script>`

createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-headers', 'content-type')
  if (req.method === 'OPTIONS') return res.end()
  if (req.method !== 'POST' || req.url !== '/save') { res.statusCode = 404; return res.end() }
  let body = ''
  for await (const chunk of req) body += chunk
  try {
    const d = JSON.parse(body)
    let html = await inlineImports(d.html)
    html = html.replace('</head>', `<style>${extCss}\nhtml,body{overflow:hidden!important}</style></head>`)
    html = await rewrite(html)
    html = html.replace('</body>', SCROLL + '</body>')
    writeFileSync(join(OUT, `${d.name}.html`), html)
    const { html: _, ...meta } = d
    writeFileSync(join(OUT, `${d.name}.json`), JSON.stringify(meta, null, 2))
    console.log('saved', d.name, `${(html.length / 1024) | 0} KB`, Object.keys(d.rects).join(','))
    res.end('ok')
  } catch (e) {
    console.error(e)
    res.statusCode = 500
    res.end(String(e))
  }
}).listen(4700, '127.0.0.1', () => console.log('capture server on :4700 ->', OUT))
