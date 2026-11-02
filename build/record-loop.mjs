// Records the Stageshow demo loop (examples/xvideos in the Stageshow kit) to
// docs/loop.mp4 and docs/loop.gif for the README.
//   node build/record-loop.mjs [url] [--compact]
import { chromium } from 'file:///C:/Users/harsh/.claude/skills/stageshow/node_modules/playwright-core/index.mjs'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const compact = process.argv.includes('--compact')
const url = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:4640/?capture=xvideos'
const out = resolve('docs')
const tmp = resolve('build/.rec')
const name = compact ? 'loop-compact' : 'loop'
const viewport = compact ? { width: 420, height: 640 } : { width: 1120, height: 680 }
const LOOP_MS = 16600

mkdirSync(out, { recursive: true })
rmSync(tmp, { recursive: true, force: true })
const browser = await chromium.launch({ channel: 'chrome' })
const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, recordVideo: { dir: tmp, size: viewport } })
const page = await ctx.newPage()
await page.goto(url)
const stage = page.locator('#example .ss-stage').first()
await stage.waitFor()
const box = await stage.boundingBox()
const t0 = Date.now()
// one full loop after the first, so the cut lands on the loop's own seam
await page.waitForTimeout(LOOP_MS * 2 + 400)
await ctx.close()
await browser.close()

const webm = join(tmp, readdirSync(tmp).find((f) => f.endsWith('.webm')))
const crop = `crop=${Math.round(box.width)}:${Math.round(box.height)}:${Math.round(box.x)}:${Math.round(box.y)}`
const ss = (LOOP_MS + 200) / 1000
const t = LOOP_MS / 1000
execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(ss), '-t', String(t), '-i', webm, '-vf', `${crop},fps=30`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', join(out, `${name}.mp4`)])
const gw = compact ? 358 : 960
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', join(out, `${name}.mp4`), '-vf', `fps=20,scale=${gw}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, join(out, `${name}.gif`)])
rmSync(tmp, { recursive: true, force: true })
console.log('wrote', join(out, `${name}.mp4`), join(out, `${name}.gif`), `(${((Date.now() - t0) / 1000).toFixed(1)}s)`)
