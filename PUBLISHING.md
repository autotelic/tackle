# Publishing

> The registry is fed by OIDC from GitHub Actions. No token — on any machine, in any store — is
> part of the path that publishes a release, and nothing here depends on a maintainer happening
> to be `npm login`ed.

## What publishes

Every package under `packages/` is `publishConfig.access: public`. `@autotelic/plumb` is
already on the registry (0.6.0) and is republished from here now; the rest have never been
published.

`@autotelic/board` is public because `@autotelic/room` is. `room` depends on it through
`workspace:*`, so a published `room` either points at a published `board` or ships a dependency
graph nobody can install, and neither tool bundles its dependencies. Publishing is the only
consistent answer, which is why `board` also grew a `files` list: `dist` and nothing else.

## Who authenticates

npm Trusted Publishing over OIDC. `release.yml` carries `id-token: write` and no secret: npm
exchanges the runner's identity for a credential that dies with the job, and attaches provenance
automatically — public package, public repository, `repository.url` matching the GitHub
repository, which every manifest now carries.

The check that keeps this honest: if a publish ever needs a credential on a maintainer's machine,
the design has regressed.

## The one human act

A trusted publisher is granted per package, with 2FA, as a browser challenge:

```sh
npm trust github @autotelic/<name> \
  --repo autotelic/tackle --file release.yml --allow-publish
npm trust list @autotelic/<name>
```

Seven packages: the six new ones plus `plumb`, which this repository now owns.

- It is account governance, so a token cannot perform it and it cannot be automated. That is the
  point: one human decision that a repository may publish, after which no human is in the loop.
- The grant expires if its first publish does not happen within two days. Grant and push in the
  same sitting.

`--allow-publish` publishes directly. `--allow-stage-publish` stages instead and waits for a
maintainer with 2FA to approve (`npm stage approve`) — stronger, and no longer automatic.

## The versions

`pnpm version` consumes `.changeset/` and rewrites every `workspace:*` to the version that will
be published. Commit the result; the release job then publishes exactly that.

```sh
pnpm version
git add -A && git commit -m "chore: version packages"
git push
```

Push with pending changesets and the job opens the "version packages" PR; push without them and
it publishes whatever npm does not have. The first publish is that same path — there is no
special bootstrap.

## If npm refuses a trusted publisher for a never-published package

`npm trust` accepts the arguments for a package npm has never seen and goes straight to the 2FA
challenge, which is evidence but not proof. If the grant is rejected, the fallback is one token
publish, done from a machine, and then deleted:

```sh
doppler secrets set NPM_TOKEN --project tackle --config dev
doppler run --project tackle --config dev -- sh -c '
  exec env "npm_config_//registry.npmjs.org/:_authToken=$NPM_TOKEN" pnpm release'
```

The environment variable is how the credential reaches npm without an `.npmrc` naming it; a
clean user config plus this variable yields `E401` rather than `ENEEDAUTH`, which is how you
know it was sent. Afterwards: grant the trusted publisher, then
`doppler secrets delete NPM_TOKEN --project tackle --config dev`. The token's whole life is that
interval, and nothing downstream may depend on it.

## Deliberately not done

- **No `NPM_TOKEN` in GitHub secrets.** OIDC is the publish path. A second credential is a second
  way in, held by the one job that can do the most damage.
- **No token in `.npmrc`, and nothing keyed to a maintainer's login.** A pipeline that only works
  because someone is logged in is not a pipeline; the counted-on credential is the release job's.
- **No release tool besides changesets.** A change lands with its bump, `changeset version`
  collects them into one PR, and `changeset publish` publishes what the registry does not have.
  npm's own `dist-tag` moves `latest`; nothing here invents a second tag owner.
