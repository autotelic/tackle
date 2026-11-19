---
"@autotelic/jig-cli": patch
"@autotelic/room": patch
---

A second install of the extension no longer breaks the boot.

pi loads extensions per scope, so one package can be present twice: a user-scope checkout
(`pi install <path>`) and a project's own dependency. Both declare the same tool names, and pi
refuses the second registration — six load errors for jig, one per tool for room, on a boot that
would otherwise work, with the winning version decided by load order.

The extension now checks whether its own tool names are already registered by a DIFFERENT file
before registering. If so it skips once, with one line naming the other install and which file
it skipped; if they belong to its own path it registers as before, because that is a reload.
A host without `getAllTools` is unchanged.

The onboarding prompt and the README also say it plainly: install the agent surface in ONE
scope.
