# Publishing

> The registry is fed by OIDC from GitHub Actions. A token appears exactly once per package —
> to create it — and is gone before the next release. Nothing depends on a maintainer being
> `npm login`ed.

## What publishes

Every package under `packages/` is `publishConfig.access: public`. `@autotelic/plumb` is
already on the registry (0.6.0) and is republished from here now; the rest have never been
published.

`@autotelic/board` is public because `@autotelic/room` is. `room` depends on it through
`workspace:*`, so a published `room` either points at a published `board` or ships a dependency
graph nobody can install, and neither tool bundles its dependencies. Publishing is the only
consistent answer, which is why `board` also grew a `files` list: `dist` and nothing else.

## The first publish of a package npm has never seen

`npm trust` cannot go first. Its man page is explicit:

> Package must exist: The package you're configuring must already exist on the npm registry.

So each new package's first version is published with a token, once, and every later version
comes from OIDC. That token must have **Bypass two-factor authentication** enabled, or the registry answers
`ERR_PNPM_OTP_NON_INTERACTIVE` and publishes nothing — a token from `npm login` is not one, and
an interactive terminal is the only other way to answer the challenge. The token lives in
Doppler, project `tackle`, config `dev`, and reaches npm as configuration rather than a file —
with a clean user config, no token gives `ENEEDAUTH` and this variable gives `E401`, which is
how you know it was sent:

```sh
doppler run --project tackle --config dev -- sh -c '
  exec env npm_config_userconfig=/tmp/empty-npmrc \
    "npm_config_//registry.npmjs.org/:_authToken=$NPM_TOKEN" pnpm run release'
```

Three things that were learned by hitting them:

- **The blank user config is load-bearing.** pnpm prefers the token in `~/.npmrc`, so a login
  token shadows this one and the registry answers `ERR_PNPM_OTP_NON_INTERACTIVE` for a token that
  cannot bypass 2FA — while the bypass token sits unused in the environment.
- **`pnpm run release`, not `pnpm release`.** pnpm owns several bare words; `pnpm version` is its
  own semver bump, so the changesets action must call the script by name.
- **A fresh package can 404 for a minute.** `npm view` is not proof that a publish failed. The
  staged path also leaves a `0.0.0-stage` placeholder version behind; `latest` still points at
  the real one, and the placeholder can be unpublished.
- **"Published successfully" can mean staged.** pnpm's staged path answers 2xx and prints success
  while the version is only staged; the next run then either finishes it or fails with `403
  cannot publish over the previously published versions`. `scripts/release.ts` is why the
  workflow no longer reports either state as the release: it builds, publishes, then reads the
  registry for each local version, retries once when a version is still absent, and fails only
  when it stays absent. `pnpm run release -- --check` answers the same question without
  publishing.

The first versions therefore carry no provenance attestation, which is the price of npm's
ordering and the only version that pays it.

## The one human act

Once a package exists, a trusted publisher is granted per package, with 2FA, as a browser
challenge:

```sh
for p in plumb joggle protocol cutlist jig-cli room board; do
  npm trust github "@autotelic/$p" \
    --repo autotelic/tackle --file release.yml --allow-publish
done
```

- It is account governance, so a token cannot perform it and it cannot be automated. That is the
  point: one human decision that a repository may publish, after which no human is in the loop.
- The registry currently allows **one** configuration per package. To change one, `npm trust
  revoke` it first.
- A new grant expires if its first publish does not happen within two days.
- `--allow-publish` publishes directly. `--allow-stage-publish` stages instead and waits for a
  maintainer with 2FA to approve (`npm stage approve`) — stronger, and no longer automatic.

## What the organization covers, and what it does not

The `@autotelic` org can require 2FA of its **members** (organization settings → Members →
Enable 2FA Enforcement). That is all it covers. npm has no organization-level trusted publisher
and no organization-level publishing-access policy: both are per package. Seven grants, seven
settings — there is no seven-for-one button.

## Closing the token door

There is no supported CLI for "Require two-factor authentication and disallow tokens"; it is the
package's Settings → Publishing access. (`npm access set mfa=` exists in the synopsis, but the
man page documents it as access control for private packages and nothing reads the setting back,
so it is not a substitute.) `npm access get status` returns visibility only.

That setting does not affect trusted publishers — they use OIDC, not tokens — so turning it on
is what makes OIDC the only way in:

```sh
doppler secrets delete NPM_TOKEN --project tackle --config dev
```

per package: Settings → Publishing access → "Require two-factor authentication and disallow
tokens".

## The versions

`pnpm run version` consumes `.changeset/` and rewrites every `workspace:*` to the version that
will be published. Commit the result; the release job then publishes exactly that.

```sh
pnpm run version
git add -A && git commit -m "chore: version packages"
git push
```

Push with pending changesets and the job opens the "version packages" PR; push without them and
it publishes whatever npm does not have.

## Deliberately not done

- **No `NPM_TOKEN` in GitHub secrets.** OIDC is the publish path. A second credential is a second
  way in, held by the one job that can do the most damage.
- **No token in `.npmrc`, and nothing keyed to a maintainer's login.** A pipeline that only works
  because someone is logged in is not a pipeline; the counted-on credential is the release job's.
- **No release tool besides changesets.** A change lands with its bump, `changeset version`
  collects them into one PR, and `changeset publish` publishes what the registry does not have.
  npm's own `dist-tag` moves `latest`; nothing here invents a second tag owner.
  `scripts/release.ts` is a verifier around that command, not a second publisher: it exists
  because the publish command's exit code is not the registry's answer.
