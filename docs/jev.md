# Asking Jev

The contract for every judgment in this repository. It exists because a question
that is not a primitive silently becomes prompt gymnastics: free prose in, a number
out, no way to say what went wrong. Source: TypeSafe's primitives documentation.

## Four primitives, four typed answers

| type     | answers                    | returns                                          |
| -------- | -------------------------- | ------------------------------------------------ |
| `Choice` | which of these options?    | `choice`, `probabilities`, `confidence`          |
| `Score`  | which level on a spectrum? | `score`, `legend`, `probabilities`, `confidence` |
| `Noul`   | is this true?              | `noul` (0 to 1) — **no separate confidence**     |
| `Box`    | where in this image?       | `box`, `confidence`                              |

Every answer is **constrained to the options supplied**. Code never recovers a value
from generated prose, and there is no primitive that returns a sentence. When a
question seems to need a sentence for an answer, the question is wrong: derive the
candidate answers in code first, then ask which one applies.

## The rules

1. **One snap judgment per question.** "Does this message convey urgency?" is a
   question. "Analyse this and decide what to do" is a task. A task is a signal to
   break it into questions and compose the answers in code.
2. **Batch every question that shares a state.** Questions in one request are
   evaluated in parallel and cost only their own tokens, so asking one you might not
   need is close to free. The expensive thing is a second round trip, not a second
   question.
3. **Answers are independent.** One question is not hidden context for another. Put
   the fact in `state` rather than hoping an earlier answer is remembered.
4. **Name the parts of `state` by path**, with backticks: `site.remedy`,
   `rules[1].message`. A path is how the model knows which field a judgment is about.
5. **`Noul` has no confidence.** Threshold the probability; do not ask for
   confidence and do not treat 0.5 as "medium".
6. **Prefer the type code can act on directly.** `Choice` maps onto branches,
   `Score` onto a threshold, `Noul` onto an `if`.
7. **Code decides.** Probabilities leave the model; thresholds, weights and branches
   are code, published where a reviewer can read them.
8. **Replay comes from the ledger, not from the model.** Every answer is recorded
   against `model + state + questions`. A re-run answers zero questions, so a
   judgment is as reproducible as a function once it has been made.

## The two shapes our questions take

**Pairwise sameness is a `Noul`.** One judgment per pair, one threshold.

    j_remedy   (noul)  "Do `a.message` and `b.message` prescribe the same repair,
                        given `a.rule` and `b.rule`?"
    j_material (noul)  "Does the difference between `a.trigger` and `b.trigger`
                        change that repair?"
    j_subcase  (noul)  "Is `b.trigger` a strict subset of `a.trigger`?"

**A label is a `Choice` over candidates code derived.** Code collects the distinct
imperative clauses, offers them as options, and the model picks one — it never
invents a label.

    remedy  (choice)  criteria = { "parse at the boundary": "...", "narrow with a
                      predicate": "...", "owner-derived value type": "..." }
                      instructions = "Which repair does `finding.message`
                      prescribe? If none applies, choose `none`."

Both shapes keep `help`/`message` prose as _state_, never as criteria: criteria
describe the options, not the material.

## Anti-patterns, each one a bug we have already written

- One `Choice` with the whole decision in `criteria` — the "decision model"
  mistake. Long criteria describing business logic is prompt gymnastics.
- Asking for a free-text answer ("what is the smallest edit?") — not a primitive.
  Ask which of the candidate edits code generated, or ask `Noul` per candidate.
- Passing a prose _answer_ into the next question's state — questions are
  independent; recompute the fact instead.
- Treating `Noul` 0.5 as "medium confidence". It is a coin.
