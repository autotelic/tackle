# How the tool works now

One picture of the pipeline as it stands after the remedy hill (rungs 0-4).

```
                    sources (a git worktree; no state of its own)
                                   |
                                   v
                 fragmentsOf(unit)  -- content-addressed, cached
                                   |
   +------------------- fact store: .joggle/cache/store.sqlite -------------------+
   |  object(id, kind, body)   fragment(id, unit)   df(id, units)                 |
   |  finding(site, rule, remedy_hash, run)      answers: the text ledger below    |
   +----------------+------------------------------------------+-------------------+
                    | atoms (facts)                            | findings
                    v                                          v
   +---------------------------------+        +------------------------------------+
   | rules: 59 plumb (per-file AST)  |        | joggle remedies                    |
   |        46 joggle (cross-file)   |        |   family (choice, <=8)             |
   +----------------+----------------+        |   clause (choice, <=8, imperative) |
                    | plans                   |   composed key: "family: clause"   |
                    v                         +--------+---------------------------+
   +---------------------------------+                 | evidence pack
   | questionnaire validator         |                 v
   |   fact | judgment | decision    |      +-----------------------------+
   |   every question <=8 options    |      | witness  (regex, deterministic) |
   |   every instruction names an    |      | judgment (j_remedy, j_material, |
   |   atoms[...] path               |      |           j_subcase)            |
   +----------------+----------------+      +-------+---------------------+---+
                    | questions, batched             |                     |
                    v                                v                     |
   +--------------------------------------------------------------------------------+
   | Jev, System One:  noul (0..1)  choice (label+probabilities)  score   |
   | every answer cached by  model + own state + ONE question -> replay  |
   +----------------+---------------------------------------------------------------+
                    | typed answers
                    v
   +-----------------------------------+        +----------------------------------+
   | code decides                      |        | answers ledger (.joggle/answers) |
   |   j_remedy > 0.8 and j_material   |<------>| text, merge=union, committed      |
   |   < 0.5 -> merge; else independent|        | the replay that makes a judgment  |
   +----------------+------------------+        | as reproducible as a function    |
                    v                           +----------------------------------+
   +-----------------------------------+
   | clusters + counterexample packs   |
   |   which sites one rule reaches    |
   |   that the other cannot, computed |
   | soundness_observed:               |
   |   sound | unsound | unobserved    |
   +-----------------------------------+
```

## The four layers, and why each exists

| layer           | answers                                                                              | cost                                |
| --------------- | ------------------------------------------------------------------------------------ | ----------------------------------- |
| **facts**       | what the workspace already knows: fragments, document frequency, import edges, types | paid once, in the store             |
| **questions**   | what genuinely needs a model: intent, acceptable variation, which reading            | one per distinct question, replayed |
| **decisions**   | which answers add up to a finding: thresholds, family boundaries, merge rules        | free, and visible                   |
| **observation** | whether the decision was right: `soundness_observed` after a fix                     | one re-run, diffed by the store     |

The ordering is the whole design: **a judgment may refine a decision, never widen it.** A pair
question can close an edge inside a family and cannot cross one. When the layers are inverted the
tool asks 17,364 questions to answer 1,431 (the rung-2 regression), and when they are in order 1,424
of 1,431 need no judgment at all.

## The loop it closes

```
  slop at the edge  ->  conformance finds it  ->  clusters by repair  ->  one fix, N sites
        ^                                                                       |
        |                                                                       v
  the rule that would have caught it  <-  a fact that replaces a judgment  <-  lesson
```

That last arrow is the point of `docs/question-audit.md`: 12 of 67 judgments are asking for a fact
the workspace already holds, and each one is named with the fact that would replace it.

```mermaid
flowchart TB
  WT["git worktree<br/>files · units"] --> FRAG["fragmentsOf(unit)<br/>content-addressed · cached"]

  subgraph STORE["fact store · .joggle/cache/store.sqlite"]
    direction LR
    OBJ["object(id, kind, body)"]
    FRG["fragment(id, unit)"]
    DF["df(id, units)"]
    FND["finding(site, rule, remedy, run)"]
  end
  FRAG --> STORE

  subgraph RULES["rules"]
    direction LR
    PLUMB["59 plumb · per-file AST"]
    JOGGLE["46 joggle · cross-file"]
  end
  OBJ -.->|"atoms: facts"| RULES
  FND --> REM

  subgraph REM["joggle remedies"]
    direction TB
    FAM["family · choice ≤8"]
    CLA["clause · choice ≤8 · imperative"]
    KEY["composed key<br/>family: clause"]
    FAM --> KEY
    CLA --> KEY
  end

  REM --> PACK["evidence pack<br/>sites · intersection · counterexample"]
  PACK --> WIT["witness · regex"]
  PACK --> JUDG["judgments<br/>j_remedy · j_material · j_subcase"]

  RULES --> PLAN["plans"]
  PLAN --> VAL{"questionnaire validator<br/>fact · judgment · decision<br/>≤8 options · atoms[...] paths"}

  VAL -->|"questions, batched"| JEV
  JUDG --> JEV

  subgraph JEV["Jev · System One"]
    direction LR
    NOUL["noul 0..1"]
    CHOICE["choice · label + probabilities"]
    SCORE["score · legend"]
  end

  JEV -->|"typed answers"| CACHE[("cache key<br/>model + own state + ONE question")]
  CACHE --> DEC["code decides<br/>j_remedy > 0.8 ∧ j_material < 0.5"]
  WIT --> DEC

  DEC --> CLUSTER["clusters + counterexample packs<br/>soundness_observed: sound · unsound · unobserved"]
  CACHE <--> LEDGER["answers ledger<br/>text · merge=union · committed"]
  LEDGER -.->|"replay: zero questions"| JEV

  CLUSTER --> AUDIT["docs/question-audit.md<br/>12 of 67 judgments<br/>a fact already answers"]
  AUDIT -.->|"write the fact, delete the question"| OBJ

  classDef fact fill:#eef,stroke:#557
  classDef judgment fill:#efe,stroke:#575
  classDef decision fill:#ffe,stroke:#775
  class STORE,RULES,PLAN fact
  class JEV,JUDG judgment
  class VAL,DEC,CLUSTER decision
```

## Correction, measured after the fact

An earlier version of this document, and the 0.17.0 changelog, described the pair judgments as
doing the clustering work: 54 witness clusters against 41 judgement clusters. A keyed run on
2026-11-28 measured what actually merges, and it is not the pair question.

- Every surviving cluster is **single-rule**. No cross-rule merge remains.
- The 56 to 40 reduction is entirely **within** rules, and the read returns true there before any
  pair answer is consulted: two messages the composed `family: clause` label puts in one place
  prescribe one repair, whatever their wording.
- The pair question's only real job is the **cross-rule gate**. In the current corpus it permitted
  zero merges.

The honest sentence is: _composed labels cluster findings within a rule; the pairwise judgement
gates cross-rule merges and, today, permitted none._ The 0.17.0 example (typeof plus
unknown-parameters as one 33-site repair) was a genuine cross-rule merge at the time, and it no
longer reproduces because those findings were fixed.

Two consequences worth keeping. A pair question that fires rarely and gates a high-stakes merge is
the worst candidate for a trained head - few positives, expensive mistakes - and the best candidate
for deletion if cross-rule redundancy turns out to be rare in practice. And the disagreement report
was naming the wrong cause: it printed "joined at 0.72" for pairs joined by the label at a
probability that crossed no threshold. A report that names the wrong cause is the defect this whole
sequence keeps finding.
