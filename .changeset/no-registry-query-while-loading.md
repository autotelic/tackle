---
"@autotelic/jig-cli": patch
"@autotelic/room": patch
---

Do not query the host registry while an extension loads.

The duplicate-install guard added in the previous patch called `pi.getAllTools()` at the top of the
factory. pi's loader installs a throwing placeholder for every action method until the extension
has committed — "Extension runtime not initialized. Action methods cannot be called during
extension loading" — so the guard did not detect anything: it made the extension fail to load on
every boot, in every repository, whether or not a second copy was installed. That is worse than
the conflict it was meant to soften.

The guard is removed. Reading pi's loader settles what a duplicate actually is: both extensions
stay loaded, one diagnostic is recorded per conflicting name, and load order decides precedence.
Detecting that is the host's job. Making sure there is one install is configuration's, which the
generated `ONBOARD.md` and the README now state in one sentence.
