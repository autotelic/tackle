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
A user-defined mapping from an event (with optional conditions) to the transition and action the loop takes in response.
_Avoid_: handler, hook, policy

**Checks**:
The verification commands (tests, lint) the loop runs against the repository after a session completes. Their results decide whether work is good; the agent never grades itself.
_Avoid_: CI

**Feature done**:
The repository-level condition `pr.open ∧ checks.passed` on the loop's branch that triggers review-oriented rules. Never based on the agent's self-report.
_Avoid_: done, finished
