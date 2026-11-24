// Run automatically by `npm publish` (via prepublishOnly). Fails fast on the mistakes that are painful to undo,
// because a published version can never be replaced.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const problems = []

// 1. No template placeholders left in anything that ships.
for (const file of ['package.json', 'LICENSE', 'README.md']) {
  const hits = readFileSync(file, 'utf8').match(/YOUR_[A-Z_]+/g)
  if (hits) problems.push(`${file} still contains placeholders: ${[...new Set(hits)].join(', ')}`)
}

// 2. The changelog documents this exact version.
if (!readFileSync('CHANGELOG.md', 'utf8').includes(`## [${pkg.version}]`)) {
  problems.push(`CHANGELOG.md has no "## [${pkg.version}]" entry`)
}

// 3. Every file the exports map points at exists (i.e. `npm run build` ran).
const targets = new Set()
const walk = (value) => {
  if (typeof value === 'string' && value.startsWith('./dist/')) targets.add(value)
  else if (value && typeof value === 'object') Object.values(value).forEach(walk)
}
walk(pkg.exports)
walk(pkg.main)
walk(pkg.module)
walk(pkg.types)
for (const target of targets) if (!existsSync(target)) problems.push(`missing build output: ${target} (run "npm run build")`)

// 4. Every bundled skill is well-formed: skills/<name>/SKILL.md whose frontmatter `name` matches its folder and has a description.
if (existsSync('skills')) {
  for (const dir of readdirSync('skills').filter((d) => statSync(`skills/${d}`).isDirectory())) {
    const file = `skills/${dir}/SKILL.md`
    if (!existsSync(file)) {
      problems.push(`${file} is missing`)
      continue
    }
    const front = /^---\n([\s\S]*?)\n---/.exec(readFileSync(file, 'utf8'))?.[1] ?? ''
    if (!new RegExp(`^name:\\s*${dir}\\s*$`, 'm').test(front)) problems.push(`${file}: frontmatter "name" must equal the folder name "${dir}"`)
    if (!/^description:\s*\S/m.test(front)) problems.push(`${file}: frontmatter "description" is missing`)
  }
}

// 5. This version is not already on the registry (skipped, with a notice, if offline).
try {
  const published = execFileSync('npm', ['view', `${pkg.name}@${pkg.version}`, 'version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  if (published) problems.push(`${pkg.name}@${pkg.version} is already published; bump the version`)
} catch (error) {
  const output = `${error.stdout ?? ''}${error.stderr ?? ''}`
  if (!/E404|404 Not Found|is not in this registry/.test(output)) console.warn('! could not reach the registry; skipping the "already published" check')
}

if (problems.length) {
  console.error('\nRelease check failed:\n' + problems.map((p) => `  - ${p}`).join('\n') + '\n')
  process.exit(1)
}
console.log(`Release check passed for ${pkg.name}@${pkg.version}`)
