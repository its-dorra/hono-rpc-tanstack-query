// Prints the CHANGELOG.md section for one version (used as the GitHub Release notes).
// Usage: node scripts/changelog-section.mjs 0.1.0
import { readFileSync } from 'node:fs'

const version = process.argv[2]
if (!version) {
  console.error('usage: node scripts/changelog-section.mjs <version>')
  process.exit(2)
}

const lines = readFileSync('CHANGELOG.md', 'utf8').split('\n')
const start = lines.findIndex((line) => line.startsWith(`## [${version}]`))
if (start === -1) {
  console.error(`CHANGELOG.md has no section for ${version}`)
  process.exit(1)
}
const end = lines.findIndex((line, i) => i > start && line.startsWith('## ['))
console.log(lines.slice(start + 1, end === -1 ? undefined : end).join('\n').trim())
