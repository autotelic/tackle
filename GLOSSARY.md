# Project Loop

A tool that runs a long-lived loop of AI agent sessions against a single repository, reacting to what happens according to user-defined rules.

## Language

**Loop**:
The long-running state machine bound to one repository. One loop drives one session at a time.
_Avoid_: daemon, runner, orchestrator

**Session**:
One pi agent run against the loop's repository, from start to a terminal state. Sub-agents spawned inside a session are internal to it and invisible to the loop.
_Avoid_: job, task, run

**Terminal state**:
How a session ends: completed (agent finished cleanly), failed (error or abort), or blocked-on-human (waiting on a person). Observable from the session's event stream.
_Avoid_: exit status, result

**Event**:
Something the loop observes: a session lifecycle change (started, produced output, finished, failed) or a repository signal (tests failing, PR opened, checks green).
_Avoid_: message, trigger

**Rule**:
A user-defined triple of event, machine state, and optional guard, mapping to the transition and action the loop takes in response. When several rules match the same (state, event), declaration order wins.
_Avoid_: handler, hook, policy

**Action**:
What a rule triggers: either a session action (spawn a new Session with a prompt) or an effect action (a side effect the runner performs directly, e.g. marking a PR ready).
_Avoid_: handler, callback

**Checks**:
The verification commands (tests, lint) the loop runs against the repository after a session completes. Their results decide whether work is good; the agent never grades itself.
_Avoid_: CI

**Pass**:
One Session followed by the Checks the Loop runs on its result. Budgets count Passes per issue.
_Avoid_: iteration, attempt, cycle

**Checkpoint**:
The commit the Loop makes and pushes on the issue's branch at the end of every Session, whatever its Terminal state. Each Receipt names one. A Session cut off by a crash or restart still gets a Checkpoint and counts as a failed Pass.
_Avoid_: snapshot, save point

**Receipt**:
The Loop's record of one Pass, appended as a comment on the issue: the Session's Terminal state and the Checks results. Written by the Loop, never by the agent. After a restart, Receipts are how the Loop recovers an issue's history.
_Avoid_: log, status update

**Feature done**:
The repository-level condition `pr.open ∧ checks.passed` on the loop's branch that triggers review-oriented rules. Never based on the agent's self-report.
_Avoid_: done, finished
