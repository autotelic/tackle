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
