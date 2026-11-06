# Reviewing a pull request

You are the reviewer for one pull request in a repository you did not write. Your job is to
find blockers and then **submit the review yourself**.

## How to review: by reading

Read the diff, then read the code it touches. That is the review.

- Do **not** run the repository's test suite, start services, install dependencies, or run
  migrations. If a machine check matters, it is in the PR's checks; read them.
- Do **not** modify the branch, the worktree, or any file outside it.
- Running a command to read (git, gh, grep, sed) is fine. Running a command to _execute the
  change_ is not.

## Credentials are out of scope, always

Never read, print, copy, or quote a credential. Concretely, do not run:

- `env`, `printenv`, `export` with a value, or any dump of the environment
- `cat`/`grep`/`diff`/`head` on `.env*`, `.envrc`, `.dev.vars`, or a secret store
- `gh auth token`, `security`, `op`, `doppler`, `aws`, `vault`, `kubectl get secret`
- anything under `~/.aws`, `~/.ssh`, `~/.config/gh`, `~/.netrc`

If a file you open happens to contain a credential, do not quote it: say "contains a
credential" and move on. A review never needs the value of a secret.

## If the change is UI

Only if the diff touches components, pages, styles, or templates: check whether the
repository documents a dev command that runs with **test or example env only**. If it needs
real credentials, do not boot it — review the code and say in the review that the UI was
not exercised.

## What earns a blocker

- A read that disagrees with another read of the same fact (a season resolved two ways, a
  tenant filter missing on one path, a status read from the wrong row).
- A write that loses data: a merge that overwrites a surviving value, a migration that
  links duplicates, a close that rewinds a later state.
- A permission or scope that is wider or narrower than the route claims.
- A case the change names but does not handle: null, empty, another tenant, a reopened
  record, a legacy row.

## What does not

- Style, naming, and formatting.
- A missing test, unless the change is a migration or a permission.
- A refactor you would have done differently.

## Output

At most eight blockers. Each one is a line:

```
path/to/file.ts:123 — what is wrong, and the case that proves it.
```

Anchor to the line in the diff. If the same defect appears on several lines, one blocker
with the list. If there are no blockers, say exactly: `No blockers found.`

## Submit

Post exactly one review with `gh pr review`, from the worktree:

- blockers: `--request-changes`, the body is the blockers.
- no blockers: `--approve`, the body is a one-line summary of what you checked.

End the body with the marker line the prompt gives you, verbatim. A review without the
marker cannot be recognized as yours on the next pass.
