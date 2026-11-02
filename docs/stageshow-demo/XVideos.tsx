import { Bar, Count, Stage, Window, type Act } from '../../kit'
import './xvideos.css'

// xVideos: a Videos tab for X. The cursor opens Videos from X's own sidebar,
// the timeline gives way to a grid of videos, one card previews under the
// pointer, the layout flips to Reels, a double-tap likes the reel (the heart
// bursts and the count rolls), a swipe brings the next one, and Home puts
// X back the way it was, which is the loop's seam.
//
// Copied from dark-hero (a dark wide hero: depth from surface steps on
// black, one lit color). Here the lit colors are X's: its blue for the
// active tab and the like pink, once, on the payoff.
//
// Real strings: X's nav, "Videos", the feed chips, two card titles and their
// authors, the reel's author and caption, its like count. Everything else is
// a line or a thumbnail.

type View = 'home' | 'grid' | 'reels'
type S = { view: View; hover: boolean; liked: boolean; burst: number; reel: number }

const initial: S = { view: 'home', hover: false, liked: false, burst: 0, reel: 0 }
const POSTER: S = { ...initial, view: 'grid' }

async function script(a: Act<S>) {
  const compact = a.layout === 'compact'
  await a.wait(700)
  if (compact) {
    await a.set({ view: 'grid' })
    await a.wait(900)
  } else {
    // 1. Videos, from X's own sidebar
    await a.move({ at: 'nav-videos', x: 0.12, y: 0.5 })
    await a.wait(250)
    await a.click()
    a.mark('grid')
    await a.set({ view: 'grid' })
    await a.wait(900)
    // 2. A card previews under the pointer
    await a.move({ at: 'card-1', x: 0.5, y: 0.32 })
    await a.set({ hover: true })
    await a.wait(1700)
    await a.set({ hover: false })
  }
  // 3. Reels
  await a.move({ at: 'seg-reels', x: 0.2, y: 0.5 })
  await a.wait(200)
  await a.click()
  a.mark('reels')
  await a.set({ view: 'reels' })
  await a.wait(1000)
  // 4. Double-tap to like
  await a.move({ at: 'reel-0', x: 0.5, y: 0.45 })
  await a.wait(300)
  await a.click(undefined, { double: true })
  a.mark('liked')
  await a.set((s) => ({ liked: true, burst: s.burst + 1 }))
  await a.wait(1600)
  // 5. Swipe to the next reel
  const r = a.rect('reel-0')
  await a.drag({ x: r.x + r.width / 2, y: r.y + r.height * 0.15 })
  await a.set({ reel: 1 })
  await a.wait(1600)
  // Back to X: the visible cause of the reset
  if (compact) {
    await a.move({ at: 'seg-grid', x: 0.25, y: 0.5 })
    await a.click()
    await a.set({ view: 'grid' })
    await a.wait(600)
    await a.snap({ reel: 0, liked: false, burst: 0 })
  } else {
    await a.move({ at: 'nav-home', x: 0.12, y: 0.5 })
    await a.wait(200)
    await a.click()
    await a.set({ view: 'home' })
    await a.wait(700)
    await a.snap({ reel: 0, liked: false, burst: 0 })
  }
  await a.move('rest')
  await a.wait(500)
}

export function XVideos() {
  return (
    <Stage<S>
      width={1040}
      height={585}
      compact={{ below: 720, width: 358, height: 560 }}
      theme="dark"
      initial={initial}
      poster={POSTER}
      script={script}
      cursor={{ at: { wide: { x: 620, y: 420 }, compact: { x: 250, y: 470 } } }}
      className="xv"
    >
      {(s, _rect, layout) => (
        <>
          <Window url="x.com/i/videotab" className="xv-win">
            <div className="xv-app" data-view={s.view}>
              {layout === 'wide' && <Nav view={s.view} />}
              <main className="xv-main">
                <Timeline show={s.view === 'home'} />
                <VideosView s={s} compact={layout === 'compact'} />
              </main>
            </div>
          </Window>
          <span data-target="rest" className="xv-rest" />
        </>
      )}
    </Stage>
  )
}

// ---- X's sidebar, its glyphs taken from x.com ----

const XLOGO = 'M21.742 21.75l-7.563-11.179 7.056-8.321h-2.456l-5.691 6.714-4.54-6.714H2.359l7.29 10.776L2.25 21.75h2.456l6.035-7.118 4.818 7.118h6.191-.008zM7.739 3.818L18.81 20.182h-2.447L5.29 3.818h2.447z'
const NAV: { id: string; label: string; d: string; on?: string }[] = [
  { id: 'home', label: 'Home', d: 'M20 9.838c0-.502-.25-.97-.668-1.248l-6.5-4.333c-.504-.336-1.16-.336-1.664 0l-6.5 4.333C4.251 8.868 4 9.336 4 9.838V18.5c0 .828.672 1.5 1.5 1.5h3v-3.5c0-1.933 1.567-3.5 3.5-3.5s3.5 1.567 3.5 3.5V20h3c.828 0 1.5-.672 1.5-1.5V9.838zm2 8.662c0 1.933-1.567 3.5-3.5 3.5h-5v-5.5c0-.829-.672-1.5-1.5-1.5s-1.5.671-1.5 1.5V22h-5C3.567 22 2 20.433 2 18.5V9.838c0-1.17.585-2.263 1.559-2.912l6.5-4.333c1.175-.784 2.707-.784 3.882 0l6.5 4.333C21.415 7.575 22 8.668 22 9.838V18.5z' },
  { id: 'explore', label: 'Explore', d: 'M10.25 3.75c-3.59 0-6.5 2.91-6.5 6.5s2.91 6.5 6.5 6.5c1.795 0 3.419-.726 4.596-1.904 1.178-1.177 1.904-2.801 1.904-4.596 0-3.59-2.91-6.5-6.5-6.5zm-8.5 6.5c0-4.694 3.806-8.5 8.5-8.5s8.5 3.806 8.5 8.5c0 1.986-.682 3.815-1.824 5.262l4.781 4.781-1.414 1.414-4.781-4.781c-1.447 1.142-3.276 1.824-5.262 1.824-4.694 0-8.5-3.806-8.5-8.5z' },
  {
    id: 'videos', label: 'Videos',
    d: 'M5 4h14a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zm0 2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1H5zm5 2.8v6.4a.5.5 0 0 0 .76.43l5.2-3.2a.5.5 0 0 0 0-.86l-5.2-3.2A.5.5 0 0 0 10 8.8z',
    on: 'M5 4h14a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zm5 4.8v6.4a.5.5 0 0 0 .76.43l5.2-3.2a.5.5 0 0 0 0-.86l-5.2-3.2A.5.5 0 0 0 10 8.8z',
  },
  { id: 'notifications', label: 'Notifications', d: 'M19.993 9.042C19.48 5.017 16.054 2 11.996 2s-7.49 3.021-7.999 7.051L2.866 18H7.1c.463 2.282 2.481 4 4.9 4s4.437-1.718 4.9-4h4.236l-1.143-8.958zM12 20c-1.306 0-2.417-.835-2.829-2h5.658c-.412 1.165-1.523 2-2.829 2zm-6.866-4l.847-6.698C6.364 6.272 8.941 4 11.996 4s5.627 2.268 6.013 5.295L18.864 16H5.134z' },
  { id: 'chat', label: 'Chat', d: 'M20.7 11.7c0-4.48-3.844-8.2-8.699-8.2-4.854 0-8.698 3.72-8.698 8.2v.015l-.001.014c-.02.667.09 1.225.25 1.767.083.28.176.545.276.839.098.285.202.595.288.918.177.663.284 1.401.156 2.271-.086.582-.274 1.191-.582 1.855 1.264.375 2.55.053 4.013-.599l.455-.203.437.242c1.07.594 1.917 1.08 3.406 1.08 4.855 0 8.7-3.72 8.7-8.199zm2 0c0 5.683-4.84 10.2-10.699 10.2-1.784 0-2.96-.555-3.95-1.095-1.876.768-4.02 1.2-6.245-.075l-.885-.505.524-.875c.54-.904.77-1.581.848-2.118.078-.526.02-.98-.11-1.463-.066-.25-.15-.502-.247-.788-.095-.277-.204-.59-.301-.92-.199-.674-.36-1.449-.332-2.39C1.322 6.002 6.154 1.5 12.002 1.5c5.859 0 10.7 4.518 10.7 10.2z' },
]

function Nav({ view }: { view: View }) {
  const active = view === 'home' ? 'home' : 'videos'
  return (
    <nav className="xv-nav">
      <svg className="xv-logo" viewBox="0 0 24 24" aria-hidden><path d={XLOGO} /></svg>
      {NAV.map((n) => (
        <div key={n.id} className="xv-navitem" data-target={`nav-${n.id}`} data-cursor="pointer" data-on={n.id === active || undefined}>
          <svg viewBox="0 0 24 24" aria-hidden><path fillRule="evenodd" d={n.id === active && n.on ? n.on : n.d} /></svg>
          <span data-label={n.label}>{n.label}</span>
        </div>
      ))}
      <div className="xv-post">Post</div>
    </nav>
  )
}

// ---- the home timeline: quiet posts, one with a video ----

function Timeline({ show }: { show: boolean }) {
  return (
    <section className="xv-layer xv-timeline" data-show={show || undefined}>
      <div className="xv-tabs">
        <span data-on>For you</span>
        <span>Following</span>
      </div>
      {[
        { w: [120, 64], lines: [420, 300], media: 'art-2' },
        { w: [96, 72], lines: [380], media: null },
        { w: [140, 56], lines: [440, 260], media: 'art-5' },
      ].map((p, i) => (
        <div key={i} className="xv-tpost">
          <Bar w={40} h={40} r={20} tone={2} />
          <div className="xv-tbody">
            <div className="xv-tline">
              <Bar w={p.w[0]!} h={9} tone={3} />
              <Bar w={p.w[1]!} h={8} tone={2} />
            </div>
            {p.lines.map((w, j) => <Bar key={j} w={w} h={8} tone={2} />)}
            {p.media && <div className={`xv-tmedia xv-art ${p.media}`}><span className="xv-play" /></div>}
          </div>
        </div>
      ))}
    </section>
  )
}

// ---- the Videos tab ----

const CARDS: { art: string; dur: string; title?: string; author?: string; meta?: string; ava: string }[] = [
  { art: 'art-1', dur: '1:05', title: 'Smash&Clash is now inside Minecraft', author: 'Harshit Khemani', meta: '1.7K views · 2h', ava: 'ava-1' },
  { art: 'art-2', dur: '0:57', title: 'Can DOOM run Smash&Clash?', author: 'Harshit Khemani', meta: '2.4K views · 5h', ava: 'ava-2' },
  { art: 'art-3', dur: '1:12', ava: 'ava-3' },
  { art: 'art-4', dur: '0:21', ava: 'ava-4' },
  { art: 'art-5', dur: '12:40', ava: 'ava-5' },
  { art: 'art-6', dur: '0:35', ava: 'ava-6' },
]

const CHIPS: { label: string; d: string }[] = [
  { label: 'For you', d: 'M4.5 10.5 12 4.5l7.5 6v8a1.5 1.5 0 0 1-1.5 1.5h-3.5v-6h-5v6H6a1.5 1.5 0 0 1-1.5-1.5z' },
  { label: 'Popular', d: 'M12 20.5c3.6 0 6-2.4 6-5.8 0-3.9-3.2-6.2-4.3-10.2-2.4 1.6-3.6 4-3.4 6.4-1-.6-1.7-1.7-1.9-2.9C6.9 9.6 6 11.9 6 14.7c0 3.4 2.4 5.8 6 5.8z' },
  { label: 'Fresh', d: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 7.5V12l3 2' },
  { label: 'Following', d: 'M9 5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM3 19.5c.6-3.2 3-5 6-5s5.4 1.8 6 5' },
  { label: 'Bookmarks', d: 'M6.5 4.5h11v15.5L12 16l-5.5 4z' },
]

function Glyph({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  )
}

const G = {
  search: 'M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM16 16l4.5 4.5',
  grid: 'M5 4.5h4a1.5 1.5 0 0 1 1.5 1.5v3A1.5 1.5 0 0 1 9 10.5H5A1.5 1.5 0 0 1 3.5 9V6A1.5 1.5 0 0 1 5 4.5zM15 4.5h4A1.5 1.5 0 0 1 20.5 6v3a1.5 1.5 0 0 1-1.5 1.5h-4A1.5 1.5 0 0 1 13.5 9V6A1.5 1.5 0 0 1 15 4.5zM5 13.5h4a1.5 1.5 0 0 1 1.5 1.5v3A1.5 1.5 0 0 1 9 19.5H5A1.5 1.5 0 0 1 3.5 18v-3A1.5 1.5 0 0 1 5 13.5zM15 13.5h4a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5v-3a1.5 1.5 0 0 1 1.5-1.5z',
  reels: 'M9 2.5h6A2.5 2.5 0 0 1 17.5 5v14a2.5 2.5 0 0 1-2.5 2.5H9A2.5 2.5 0 0 1 6.5 19V5A2.5 2.5 0 0 1 9 2.5zM10.5 9.5v5l4-2.5z',
  heart: 'M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z',
  reply: 'M4.5 11.5a7 7 0 0 1 7-7h1a7 7 0 0 1 0 14H8l-3.5 2.5v-4a7 7 0 0 1 0-5.5z',
  repost: 'M7 7.5h9.5a2 2 0 0 1 2 2V13M17 16.5H7.5a2 2 0 0 1-2-2V11M4 8.5l3-3 3 3M20 15.5l-3 3-3-3',
  bookmark: 'M6.5 4.5h11v15.5L12 16l-5.5 4z',
}

function VideosView({ s, compact }: { s: S; compact: boolean }) {
  const reels = s.view === 'reels'
  return (
    <section className="xv-layer xv-videos" data-show={s.view !== 'home' || undefined}>
      <div className="xv-head">
        <div className="xv-bar">
          <div className="xv-h1">Videos</div>
          {!compact && (
            <div className="xv-search">
              <Glyph d={G.search} />
              <span>Search videos</span>
            </div>
          )}
          <div className="xv-seg">
            <span className="xv-seg-pill" data-at={reels ? 'reels' : 'grid'} />
            <span className="xv-segbtn" data-target="seg-grid" data-cursor="pointer" data-on={!reels || undefined}><Glyph d={G.grid} />{!compact && 'Grid'}</span>
            <span className="xv-segbtn" data-target="seg-reels" data-cursor="pointer" data-on={reels || undefined}><Glyph d={G.reels} />{!compact && 'Reels'}</span>
          </div>
        </div>
        <div className="xv-chips">
          {CHIPS.map((c, i) => (
            <span key={c.label} className="xv-chip" data-on={i === 0 || undefined}><Glyph d={c.d} size={15} />{c.label}</span>
          ))}
        </div>
      </div>

      <div className="xv-stagearea">
        <div className="xv-layer xv-grid" data-show={!reels || undefined}>
          {CARDS.slice(0, compact ? 4 : 6).map((c, i) => (
            <div key={i} className="xv-card" data-target={`card-${i}`} data-cursor="pointer" data-hover-play={(i === 1 && s.hover) || undefined}>
              <div className="xv-media">
                <div className={`xv-thumb xv-art ${c.art}`} />
                <span className="xv-dur">{c.dur}</span>
                <span className="xv-preview"><i /></span>
              </div>
              <div className="xv-meta">
                <span className={`xv-ava xv-art ${c.ava}`} />
                {c.title ? (
                  <div className="xv-lines">
                    <div className="xv-title">{c.title}</div>
                    <div className="xv-sub">{c.author}</div>
                    <div className="xv-sub">{c.meta}</div>
                  </div>
                ) : (
                  <div className="xv-lines xv-lines--bars">
                    <Bar w={[180, 150, 200, 160][i % 4]!} h={9} tone={3} />
                    <Bar w={[90, 110, 80, 100][i % 4]!} h={8} tone={2} />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="xv-layer xv-reels" data-show={reels || undefined}>
          <div className="xv-reeltrack" style={{ transform: `translateY(${-s.reel * 100}%)` }}>
            {[0, 1].map((i) => (
              <div key={i} className="xv-reelslide">
                <div className={`xv-reel xv-art ${i ? 'art-7' : 'art-4'}`} data-target={`reel-${i}`} data-cursor="pointer">
                  <span className="xv-burst" key={i === 0 ? s.burst : 0} data-go={(i === 0 && s.burst > 0) || undefined}>
                    <svg viewBox="0 0 24 24" aria-hidden><path d={G.heart} /></svg>
                  </span>
                  <div className="xv-reelinfo">
                    <div className="xv-reelby"><span className={`xv-ava xv-art ${i ? 'ava-2' : 'ava-4'}`} />{i ? <Bar w={90} h={9} tone={4} /> : <b>Harshit Khemani</b>}</div>
                    {i ? <Bar w={170} h={8} tone={3} /> : <p>Smash&Clash is now live on Snapchat</p>}
                  </div>
                  <span className="xv-reelprog"><i data-run={(s.view === 'reels' && s.reel === i) || undefined} /></span>
                </div>
                <div className="xv-rail">
                  <span className="xv-act xv-like" data-on={(i === 0 && s.liked) || undefined}>
                    <span className="xv-round"><Glyph d={G.heart} size={22} /></span>
                    {i === 0 ? <Count value={s.liked ? 2482 : 2481} /> : '980'}
                  </span>
                  <span className="xv-act"><span className="xv-round"><Glyph d={G.reply} size={22} /></span>{i ? '41' : '182'}</span>
                  <span className="xv-act"><span className="xv-round"><Glyph d={G.repost} size={22} /></span>{i ? '12' : '64'}</span>
                  <span className="xv-act"><span className="xv-round"><Glyph d={G.bookmark} size={22} /></span>{i ? '9' : '311'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
