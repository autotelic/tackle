# 0033 — TAC-15 — it is a document now, not a thread

`docs/observability.md`, 138 lines, so none of this lives only in turns with a session that may compact:

- the boundary (host owns the provider, domain owns the attributes; the exporter is the only thing that
  stays out of a domain package), and the catalog fact that `@effect/opentelemetry@4.1.5` is already there
  with no consumer;
- cardinality (IDs on spans, bounded dimensions on metrics) and refusal-weighted sampling, because a blanket
  rate drops exactly the events worth keeping;
- OTLP first, vendor translation in a collector;
- presence by pull, three states from `observedThrough`, served from memory on the tailnet listener;
- the naming rule: `leaseGenerationHint` everywhere, `leaseAuthority` beside it, takeover reads only the
  grant;
- the contract-test rule with the comment that keeps it alive: *“spelled literally on purpose: this name is
  telemetry surface; renaming it is a migration.”*

One addition that came out of writing it down. A change-detector test — asserting a literal name the
production code also contains — is normally a **smell**, because it duplicates *implementation*. It is correct
here because it duplicates *contract*. That distinction only survives if each such test says which it is,
which is why the comment is part of the rule and not a nicety: without it, the next maintainer “fixes” the
duplication by extracting a constant and deletes the only check we have.

**Open question:** is “this literal is contract, and here is why” mechanically checkable, or is it a joggle
question? My vote: joggle. Whether a duplicated literal is a contract or an implementation detail is
exactly the judgement that has no fixture — and the cost of automating it would be a rule that fires on
both, which is how a linter starts generating the false positives we already spent a day narrowing.
