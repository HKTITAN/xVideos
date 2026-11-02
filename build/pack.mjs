// Writes dist/x-videos-tab-<version>.zip: only what Chrome loads, plus the
// license and readme. Unzip it and Load unpacked.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'

const { version } = JSON.parse(readFileSync('manifest.json', 'utf8'))
const zip = `dist/x-videos-tab-${version}.zip`
mkdirSync('dist', { recursive: true })
rmSync(zip, { force: true })
// Windows' bsdtar and macOS' tar both write zip with -a
execFileSync('tar', ['-a', '-c', '-f', zip, 'manifest.json', 'rules.json', 'icons', 'src', 'LICENSE', 'README.md'], { stdio: 'inherit' })
console.log(zip)
