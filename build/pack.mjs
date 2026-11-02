// Writes dist/xvideos-<version>.zip: only what Chrome loads, plus the
// license and readme. Unzip it and Load unpacked.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'

const { version } = JSON.parse(readFileSync('manifest.json', 'utf8'))
const zip = `dist/xvideos-${version}.zip`
mkdirSync('dist', { recursive: true })
rmSync(zip, { force: true })
// bsdtar writes zip with -a: Windows' own (not Git Bash's GNU tar) and macOS'
const tar = process.platform === 'win32' ? 'C:/Windows/System32/tar.exe' : 'tar'
execFileSync(tar, ['-a', '-c', '-f', zip, 'manifest.json', 'rules.json', 'icons', 'src', 'LICENSE', 'README.md'], { stdio: 'inherit' })
console.log(zip)
