# Publishing to npm

A published version can never be replaced or reused, so this process front-loads checks. The package has a guard
(`scripts/check-release.mjs`, run automatically by `npm publish`) that blocks the most common mistakes.

## 0. Pick the name

The name in `package.json` must be free on the registry. Check right before publishing:

```bash
npm view @dorra/hono-rpc-tanstack-query name    # E404 = free; any output = taken
```

`hono-tanstack-query` is **already taken** by another package, which is why this project uses `@dorra/hono-rpc-tanstack-query`.

To use another name (or a scope such as `@your-username/hono-rpc-tanstack-query`, which is always yours and never conflicts):

```bash
NEW="@your-username/hono-rpc-tanstack-query"
sed -i "s#@dorra/hono-rpc-tanstack-query#$NEW#g" package.json README.md CHANGELOG.md PUBLISHING.md   # macOS: sed -i ''
grep -rn "@dorra/hono-rpc-tanstack-query" . --exclude-dir=node_modules --exclude-dir=dist
```

Scoped packages are private by default; `publishConfig.access: "public"` is already set, so `npm publish` works unchanged.
Do not use the `@hono` scope: it belongs to the Hono organisation.

## 1. One-time account setup

1. Create an account at <https://www.npmjs.com/signup> and verify your email.
2. Enable two-factor authentication (Account → Two-Factor Authentication). Publishing requires it.
3. Log in from the terminal and check:

```bash
npm login
npm whoami
```

## 2. Fill in the placeholders

Replace every `YOUR_NAME` and `YOUR_GITHUB_USERNAME` in `package.json`, `LICENSE` and `README.md`. The release check lists any that remain:

```bash
node scripts/check-release.mjs
```

Create the GitHub repository with the same name and push (needed for CI, provenance and the `repository` link on npm):

```bash
git init && git add -A && git commit -m "feat: initial release"
git branch -M main
git remote add origin git@github.com:its-dorra/hono-rpc-tanstack-query.git
git push -u origin main
```

## 3. Verify locally

```bash
npm ci
npm run typecheck
npm run test:coverage
npm run build
npm run check:package        # publint + are-the-types-wrong (the better-result CJS warning is expected: it is ESM-only)
npm pack --dry-run           # lists exactly what would be published: dist/, skills/, README.md, LICENSE, CHANGELOG.md, package.json
```

Then install the real tarball in a scratch project, as your users would:

```bash
npm pack                                           # creates @dorra/hono-rpc-tanstack-query-0.1.0.tgz
mkdir /tmp/try && cd /tmp/try && npm init -y
npm i /path/to/@dorra/hono-rpc-tanstack-query-0.1.0.tgz hono @tanstack/query-core
node -e "import('@dorra/hono-rpc-tanstack-query').then(m => console.log(Object.keys(m)))"
```

## 4. First publish (from your machine)

```bash
npm publish
```

`prepublishOnly` runs the release check, type-check, tests, build and `publint` first. npm then asks for a one-time code from your authenticator app.

Verify:

```bash
npm view @dorra/hono-rpc-tanstack-query version
npm i @dorra/hono-rpc-tanstack-query        # in a scratch project
```

`0.1.0` is a good first version: under semver, `0.x` signals that the API may still change in minor releases.

## 5. Later releases from CI (no stored token)

npm supports **trusted publishing**: your GitHub Actions workflow proves its identity to npm with a short-lived OIDC credential, so there is no
long-lived token to leak or rotate, and provenance (a signed link from the package to the exact commit and workflow) is attached automatically.

One-time setup, after the first publish (the package must exist before a trusted publisher can be configured):

1. On npmjs.com open the package → **Settings** → **Trusted Publisher** → **GitHub Actions**.
2. Enter your GitHub user/org, the repository name, the workflow file name `release.yml`, and the environment name `release`.
3. In the GitHub repo create an environment called `release` (Settings → Environments). Optionally add yourself as a required reviewer for a manual approval gate.

Requirements (already handled in `.github/workflows/release.yml`): a GitHub-hosted runner, `permissions: id-token: write`, and **npm CLI 11.5.1 or newer**.
Node 22 ships npm 10, so the workflow uses Node 24. Check npm's current docs if these requirements change.

Release flow:

```bash
# 1. update CHANGELOG.md (add a "## [0.1.1] - YYYY-MM-DD" section)
npm version patch            # or minor / major: bumps package.json, commits, and creates the tag v0.1.1
git push --follow-tags       # the tag triggers .github/workflows/release.yml
```

What the workflow does on a `v*` tag:

1. Checks out the tagged commit, installs with `npm ci`, and refuses to continue if the tag does not equal `v` + the version in `package.json`.
2. Asks npm whether this exact version is already published. If it is, publishing is skipped (this is what makes the first release below work).
3. Otherwise runs the type-check, tests, build and `publint`, then `npm publish` with the right dist-tag (section 6) and provenance.
4. Zips every folder in `skills/` into a `<name>.skill` file.
5. Creates a GitHub Release for the tag, with the CHANGELOG section as the notes and the `.skill` file attached (prereleases are marked as such).

**First release.** The first publish is manual (section 4), because a trusted publisher can only be configured for a package that exists. Afterwards
create the tag for the record and let the workflow produce the GitHub Release: `git tag v0.1.0 && git push origin v0.1.0`. It will see that `0.1.0` is already on npm,
skip publishing, and still create the Release with the `.skill` file.

If you prefer a stored token over trusted publishing, create a granular access token limited to this package (they expire and must be rotated), save it as the
`NPM_TOKEN` repository secret, and uncomment the `env` block in the workflow.

## 5b. Git tags, in short

A tag is a named pointer to one commit. `npm version` creates `vX.Y.Z` on the version-bump commit; pushing it is what triggers the workflow.
A _GitHub Release_ is a page built on top of a tag (notes plus downloadable files); the workflow creates it. Tags are permanent history: deleting one does
not unpublish anything from npm. To redo a failed release before anything was published, delete the tag locally and remotely
(`git tag -d v0.1.1 && git push origin :refs/tags/v0.1.1`), fix the problem, and tag again.

## 6. Prereleases and tags

```bash
npm version prerelease --preid=beta     # 0.2.0-beta.0 and tag v0.2.0-beta.0
git push --follow-tags                  # the workflow publishes it under the dist-tag "beta" and marks the GitHub Release as a prerelease
npm i @dorra/hono-rpc-tanstack-query@beta      # users opt in explicitly
npm dist-tag ls @dorra/hono-rpc-tanstack-query
```

The workflow derives the dist-tag from the version (`0.2.0-beta.0` becomes `beta`, `1.0.0-rc.1` becomes `rc`, anything else becomes `next`).
This matters: **npm 10 silently publishes a prerelease as `latest`** (every user would get the beta), while npm 11 refuses to publish a prerelease without `--tag`.
When publishing by hand, always pass it: `npm publish --tag beta`.

## 7. If something goes wrong

- **Never reuse a version.** If a bad version is out, publish a fixed one and run `npm deprecate @dorra/hono-rpc-tanstack-query@0.1.0 "use 0.1.1"`.
- `npm unpublish` is heavily restricted (generally only within a short window after publishing and only if nothing depends on it); prefer `deprecate`.
- `403 ... cannot publish over the previously published versions`: bump the version.
- `403 ... Package name too similar to existing package` or `You do not have permission`: the name is taken or reserved; pick another (section 0).
- `E401` / `ENEEDAUTH` in CI with trusted publishing: npm is older than 11.5.1, or the trusted publisher fields (repo, workflow file, environment) do not match exactly.

## 8. Versioning policy for this library

TypeScript types are part of the public API. Treat as **breaking** (major, or minor while `0.x`): removing or renaming an export or option,
narrowing an accepted input type, widening a returned type, or changing the shape of `error` / `SafeResult`.
**Minor**: new options, helpers or subpath exports. **Patch**: fixes with no type-level change. Record every change in `CHANGELOG.md`.
