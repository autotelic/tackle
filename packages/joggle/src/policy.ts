/**
 * Configuration for the search, and nothing else.
 *
 * The first version of this file held sixteen numbers that *decided* things:
 * probability floors, weights for a hand-rolled composite score, confidence
 * gates. That is the entropy machine's disease with an API bill -- a person's
 * guess wearing a number, unreviewable and impossible to argue with, and the
 * reason the earlier rules could only be improved by fiddling.
 *
 * Every decision now belongs to exactly one Effect Decision, and code reads its
 * answer. Numbers survive only where they bound *search*: how similar a pair
 * must be before it is worth a call, and how many calls a run may make. Those
 * are recall and cost knobs. Judging a candidate is the model's job; finding
 * candidates is the code's.
 */

export const policy = {
  /** Surfaced by `joggle --version`. */
  version: "0.1.0",

  /** The System One model every rule judges with. */
  model: "jev-latest",

  /**
   * Part of the judgement cache key. Bump it when a question's wording, options
   * or evidence change, so verdicts produced by older questions are not replayed
   * against newer ones.
   */
  decisionVersion: "2026-09-25",

  /**
   * The declared analysis version: a FALLBACK and an OVERRIDE, not the gate.
   *
   * This used to be the gate, and a hand-bumped gate is a promise to remember.
   * Forgetting it means the next run replays a report produced by rules that no
   * longer exist -- which happened twice in one session, and both times the output
   * looked entirely plausible, because a stale report is not malformed, it is just
   * wrong.
   *
   * The unchanged-run short-circuit now keys on a hash of the tool's own source
   * (see fingerprint.ts), so a change to a rule, a threshold or a question cannot
   * be missed. Question versioning still covers question WORDING, because the
   * judgement cache keys on it directly.
   *
   * This string survives for the case a hash cannot serve: when the sources cannot
   * be read, so a run in an unusual installation degrades to the old behaviour
   * rather than breaking.
   *
   * There is deliberately no way to opt out of the hash yet. A cosmetic edit
   * therefore invalidates the run cache, which is the conservative direction: the
   * cost is re-analysis, the cost of the other direction is a wrong report. An
   * override that skips the hash is the obvious next step and does not exist.
   */
  analysisVersion: "2026-09-05",

  decision: {
    baseUrl: "https://api.typesafe.ai",
    /**
     * How many times a Noul is asked, in one request.
     *
     * A yes/no comes back as one number with no second signal: `verdictOf` gives a
     * Choice a margin from its distribution and gives a Noul nothing, so a Noul is
     * gated by the probability floor alone. Asking it again and reading the
     * AGREEMENT gives it the margin a Choice gets for free -- the self-consistency
     * cookbook's pattern, and jev is built to be stable across repeats. A Choice
     * is asked once: its distribution already carries the signal, and repeating it
     * would spend a call to learn nothing.
     */
    consistency: { repeats: 3 },
    /**
     * Characters of shared state one request may carry.
     *
     * The engine batches every planned rule's questions into one request, and the
     * provider has a token ceiling: a run of joggle against itself sent 105
     * candidates' evidence at once and came back HTTP 400
     * `max_tokens_exceeded`, which every judged rule then read as "unreadable".
     * So the plans are cut into requests that fit. The per-question cache keeps a
     * chunk boundary from costing a re-judgement.
     */
    maxStateChars: 24000,
    /**
     * Input tokens one run may spend on judgement.
     *
     * A backstop, not a target. The per-decision cache means a run pays only for
     * evidence never judged before, so a push costs almost nothing and a cold run
     * on a large repository costs a lot once. This bounds the runaway: when the
     * estimate passes it, the run stops judging and reports what it did not judge
     * as budget drops.
     */
    maxInputTokens: 1000000,
    /** How long a successful judgement stays fresh, in days. */
    timeToLiveDays: 30,
    /**
     * Candidates per request. ONE, and the measurement is why.
     *
     * The parallel-questions cookbook reports batching 13 questions onto one
     * shared document as 12.2x cheaper and 10x faster with no change in answers,
     * and it says exactly when that applies: "the document dominates every
     * request, so N single-question calls pay for it N times... The bigger the
     * document, the closer the saving gets to a full Nx."
     *
     * Our candidates are not one shared document. They are different clusters
     * with different evidence, so there is nothing to amortise -- the saving is
     * the per-request boilerplate and nothing else. Measured on 80 identical
     * requests judged both ways:
     *
     *   unbatched   80 calls   101,903 input tokens
     *   batched      5 calls    82,091 input tokens   (19%, not 12x)
     *   identical verdicts: 37/80 = 46%
     *
     * And the disagreements were systematic rather than noisy: redundancy
     * scores fell by 0.05-0.10 across the board, and `member_0` started winning
     * the canonical choice far more often. That is context rot and position
     * bias, exactly what the primitives page warns about when it says to give
     * each question only the context it needs.
     *
     * So batching is OFF by default and the speed comes from concurrency, which
     * is the other pattern the docs prescribe -- the re-ranking cookbook fires
     * 1,200 independent calls through a thread pool and calls it cheap. The
     * batching machinery stays because it is the right lever for a state that IS
     * shared, such as a naming family judged one member per question.
     */
    batchCandidates: 1,
    /** Independent requests in flight at once. */
    requestConcurrency: 16,
    /**
     * How good an answer has to be before a rule may act on it.
     *
     * A probability decision is a yes/no question, so its answer is a VERDICT,
     * not a ranking: 0.2 is the model saying no. Nothing read that. `worth_fixing`
     * and `one_concept` and `redundant` were kept only as sort keys while the
     * classification decided, so on Shakti 237 findings were reported where the model had
     * already answered "not worth a reviewer's time" and been overruled by a
     * different question.
     *
     * The margin is winner minus runner-up in the classification's own distribution:
     * whether the model picked an option or shrugged across two. Raw `confidence`
     * measured uninformative here and is still only reported, but `probabilities`
     * arrived with every answer from the first day and nothing ever read it.
     */
    gates: {
      probabilityFloor: 0.5,
      minMargin: 0.25,
      /**
       * Below this, an answer is reported for review rather than acted on.
       *
       * TypeSafe's confidence is the shape of the probability distribution: a
       * clear winner is near 1, a shrug across the options is low. The docs route
       * on it in three ranges -- act, review, drop -- and joggle had only two.
       * A non-decisive choice was dropped as if the model had said no, when it
       * was saying "I am not sure", which is a different answer and belongs in
       * the report as an info finding a reader can weigh.
       */
      reviewFloor: 0.6,
    },
    /** Token budget for one request when batching is used. Around 32,000 is the
     *  API limit, shared between state and questions. */
    batchTokens: 20000,
  },

  /**
   * Near-duplicate search. These bound how many pairs are offered to the model,
   * never whether a pair is duplication.
   */
  duplicateMeaning: {
    /** Structural overlap below which a pair is not worth a call. */
    minSimilarity: 0.7,
    /** Very short bodies match by accident; skip them. */
    minTokens: 12,
    /** At 1.0 the exact-duplicate rule already owns the pair. */
    maxSimilarity: 0.995,
    /**
     * Clusters sent for judgement in one run.
     *
     * This used to cap *pairs*, applied by sorting them by similarity and
     * slicing. That is a selection, not a bound: on one codebase forty
     * high-scoring pairs elsewhere in the tree spent the whole budget and the
     * eighteen definitions of `formatDate` were never compared at all. Pair
     * generation is now complete up to a provable length filter, and the only
     * remaining bound is on how many clusters get judged -- with the overflow
     * named in the report rather than dropped.
     */
    maxClusters: 400,
  },

  /**
   * Groups of fields that repeat without a name.
   *
   * `minOccurrences` is a search bound and the only number here that decides what
   * is worth reporting: two declarations sharing three fields is a coincidence,
   * nine is a concept. Everything else bounds the work.
   */
  nameThePrimitive: {
    minFields: 3,
    minOccurrences: 6,
    maxFindings: 400,
  },

  /**
   * Export names a framework calls by file.
   *
   * A `loader` is not a hoist candidate and two `loader`s are not shared logic,
   * whatever they contain: the framework asks for one per route and calls it by
   * name, so there is nothing to consolidate and nothing to move. Kept here rather
   * than in a rule because two rules need it and a second copy is a second thing
   * to update.
   */
  frameworkExports: [
    "loader",
    "action",
    "clientLoader",
    "clientAction",
    "meta",
    "links",
    "headers",
    "ErrorBoundary",
    "HydrateFallback",
    "shouldRevalidate",
    "middleware",
    // Migrations and seeds: the runner calls these by name, one per file.
    "up",
    "down",
    "seed",
    // Test runners. A hook is scaffolding for an assertion, not a rule.
    "beforeAll",
    "afterAll",
    "beforeEach",
    "afterEach",
  ],

  /**
   * Name retrieval cost.
   *
   * `minFiles` is the candidate filter, not the verdict: a single word reached
   * from fewer files than this is not worth judging. Whether a name at or above
   * it actually fails as an address is the model's call.
   */
  nameAsAddress: {
    minFiles: 12,
    /** Names judged per run. */
    maxFiles: 200,
    /** Calling files shown to the model, as a sample. */
    maxCallers: 30,
  },

  /*
   * Name retrieval cost.
   *
   * `minFiles` was chosen from the distribution rather than guessed. Measured
   * across four repositories, the reach of a single-word export is bimodal: one
   * name at 14 files and everything else at 4 or fewer. `cn`, the classname
   * helper, is that one name -- and a two-letter export used in twenty-one files
   * is precisely the address the reference material describes as unsearchable.
   * Twelve sits in the empty middle of the distribution, where the two modes
   * separate and no threshold in between would change the answer.
   */

  /**
   * Orchestration comparison (kept for the call-pattern rule below).
   *
   * `minCalls` is what makes a shared call sequence mean something: two functions
   * that each make one call are not "the same orchestration", they are two
   * functions with one call. It is a search bound, and the only number here.
   */
  callPattern: {
    minCalls: 4,
    maxFindings: 400,
  },

  /**
   * How many modules one run will classify.
   *
   * One question per module, batched, and content-addressed, so a second rule
   * asking about the same modules replays rather than calls. The bound is against
   * a pathological repository rather than a budget anybody should reach.
   */
  moduleRoles: {
    maxModules: 600,
  },

  /**
   * Object literals that should be a named type.
   *
   * `minKeys` is what separates a shape from a coincidence: two literals sharing
   * one key are two literals, not a missing type.
   */
  objectShape: {
    minKeys: 3,
    maxFindings: 300,
    /**
     * How many files a shape must span before the finding is a warning.
     *
     * A shape in two files is a pair that may be a coincidence; one in three or
     * more is a pattern somebody keeps re-writing. Both are reported -- the pair
     * as a notice -- because the difference is what a reader needs, not a reason
     * to discard the pair.
     */
    warnFromFiles: 3,
  },

  /**
   * Field-set composition analysis.
   *
   * Both numbers bound SEARCH, not judgement: this rule is deterministic and
   * compares sets, so the only question is how many types one run will look at.
   */
  composeTypes: {
    /** Fewer than this and a shared field set means nothing. */
    minFields: 3,
    /** Types compared per run. Beyond this the report says what it skipped. */
    maxTypes: 4000,
  },

  /**
   * Package-and-dependency pairs sent for judgement in one run.
   *
   * The candidate set is small by construction -- distinct pairs, not import
   * statements -- so this is a ceiling against a pathological repository rather
   * than a budget anybody should reach.
   */
  dependencyFit: {
    maxDependencies: 400,
  },

  /**
   * Semantic search over the declarations.
   *
   * One request ranks the candidates with a Choice and asks a Noul whether the
   * codebase answers at all. `maxCandidates` is the context bound -- the model
   * reads worse as unrelated state grows -- and the keyword prefilter is what
   * keeps the state to what the query is plausibly about.
   */
  ask: {
    /** Tokens below which a declaration has nothing to match a query against. */
    minTokens: 20,
    /** Candidates per request. The state bound, not a cost bound. */
    maxCandidates: 200,
    /** Characters of a candidate's body sent as state. */
    maxSourceChars: 800,
    /**
     * Input tokens one ask may cost. One request carries a decision per
     * candidate, so the candidate list is trimmed to this before it is sent --
     * a whole-repository ask otherwise exceeds the provider's output ceiling.
     * Smaller than the check's budget on purpose: check chunks, ask does not.
     */
    maxInputTokens: 8000,
    /** Matches printed. */
    top: 10,
  },

  /**
   * A run of calls two declarations share without sharing the whole sequence.
   *
   * `minCalls` is what makes a shared run mean something: three calls in a row
   * can be a habit, and a longer run is a helper someone inlined. Deterministic,
   * so this only bounds the work and the report.
   */
  duplicateCallRun: {
    minCalls: 4,
    maxFindings: 200,
  },

  /**
   * A function that inlines what an existing declaration already does.
   *
   * Lower than the call-run floor, because the claim is stronger: the whole body
   * of an existing declaration appears inside another one, so there is a name to
   * call rather than a run to extract.
   */
  reimplementedPrimitive: {
    minCalls: 3,
    /** Pairs handed to one request. Above this the run's budget bounds it. */
    maxPairs: 200,
  },

  /**
   * A file with a wide surface and little behind it.
   *
   * Ousterhout's ratio: implementation lines over exports. `minExports` keeps a
   * small file out of it, and `minDepth` is the score below which a wide file is
   * a grab bag rather than a module.
   */
  shallowModule: {
    minExports: 5,
    minDepth: 2,
    /** Files judged per run. */
    maxFiles: 400,
  },

  /**
   * Functions sent for a paired-operation judgement in one run.
   *
   * The candidate filter is exact -- one half of a pair and not the other -- so
   * this is a ceiling rather than a budget.
   */
  temporalCoupling: {
    maxDeclarations: 400,
    /**
     * Operations that acquire or open a resource, and the call that releases it.
     *
     * A DECLARED convention, not a fact about this repository: which operations
     * pair is knowledge the author has about resource APIs, and it is not
     * derivable from the code -- `lock`/`unlock` is English, not structure. It
     * lives here, reviewable and overridable, rather than hidden in the rule; the
     * rule's JUDGEMENT (is this acquire unpaired?) is still the model's. See the
     * "declared conventions" section of docs/rule-coupling.md.
     */
    pairs: [
      ["lock", "unlock"],
      ["acquire", "release"],
      ["connect", "disconnect"],
      ["subscribe", "unsubscribe"],
      ["mount", "unmount"],
    ],
  },

  /**
   * Rule files sent for a self-audit in one run.
   *
   * The candidate filter is a `defineRule` call. The ceiling is against a
   * repository with an unusual number of rules.
   */
  ruleJudgment: {
    maxRules: 200,
  },

  /**
   * A domain word the prose repeats and no name uses.
   *
   * `minMentions` is what separates a concept from a turn of phrase: a word the
   * prose says once is a word, one it repeats is a thing.
   */
  languageDrift: {
    minMentions: 3,
    /** Files judged per run. */
    maxFiles: 200,
  },

  /**
   * One field name with incompatible types in two declarations.
   *
   * Deterministic: it compares the recorded type text of every interface and type
   * alias field. The bound is against a pathological repository rather than a
   * budget anybody should reach.
   */
  fieldTypeDrift: {
    maxFindings: 200,
    /**
     * Words a field name must have before its type is compared.
     *
     * A single-word field is a generic slot: `id`, `name`, `type`, `files` mean
     * whatever their declaration says, and two of them with different types are
     * two concepts, not one that drifted. A name of two words or more is a
     * concept -- `supervisorRate`, `regularPayTotal` -- and one concept with two
     * types is the defect.
     */
    minWords: 2,
  },

  /**
   * Documented declarations sent for a doc-vs-code check in one run.
   *
   * The candidate filter is structural: an exported declaration with a doc block
   * and enough body to document. The ceiling is against a pathological
   * repository rather than a budget anybody should reach.
   */
  docMatchesCode: {
    maxDeclarations: 400,
    /** Tokens below which a declaration has nothing for a doc to describe. */
    minTokens: 40,
  },

  /**
   * Declarations sent for judgement in one run.
   *
   * The candidate filter is structural and deliberately narrow -- an exported
   * function, not a component, not a framework export, with enough in it to hold
   * a rule -- so this is a ceiling rather than a budget.
   */
  hoistToDomain: {
    maxDeclarations: 600,
    /** Tokens below which a declaration cannot be holding a rule. */
    minTokens: 40,
  },

  duplicateImplementation: {
    maxClusters: 500,
    /**
     * Tokens below which a declaration is too small to be a duplicate of
     * anything.
     *
     * Shape equality is exact, so this rule had no floor at all and grouped
     * `type ErrorResponse = any` with `type ShippingTax = any` -- three
     * one-line placeholders in two different apps, reported as "they are one
     * thing". They are not; they are both `any`. The near-duplicate rule has
     * carried a floor for this reason from the start.
     */
    minTokens: 8,
  },

  /**
   * Name-family search.
   *
   * A pair of names is judged on its own; the rule does not cluster, because
   * "is this name another spelling of that one" is a question about two things.
   * Union-find over a non-transitive relation chained every `*Modal` in one
   * codebase into a single eighty-seven member "concept", which is not a
   * judgement anyone can make or act on.
   */
  namingDrift: {
    /** Name-root overlap below which a pair is not worth a call. */
    minScore: 0.5,
    /**
     * Words two names must share beyond a category noun. `AddContactModal` and
     * `DeleteTaskModal` share one word and are two members of a category; two
     * spellings of one concept share at least two.
     */
    minSharedWords: 2,
    /**
     * High on purpose. Name pairs are cheap to enumerate and cheap to judge, and
     * a budget that truncates 1,564 of 1,864 real candidates is a bigger problem
     * than the time it saves: it hides the rule's actual yield. Raise the
     * evidence cost or tighten the candidate filter instead of capping this.
     */
    maxClusters: 4000,
  },

  /**
   * When a page's own state and markup look like they belong in a bundle.
   *
   * These are TRIGGERS, not verdicts. The first version of this rule treated
   * every file under `routes/` as a page that should conform, which produced
   * 1,216 candidates against Shakti's 280 real route and modal files, flagged
   * 392 of them, and gave the model almost nothing to be confident about: 237 of
   * the flagged pages scored under 0.3. A page that composes local components
   * and shares no state needs no bundle, so the rule now asks only about pages
   * under actual state pressure.
   */
  pageNeedsComposition: {
    /** useState calls before a page's state looks like a provider's business. */
    minLocalState: 3,
    /** Inline JSX elements before a page's markup looks like someone's block. */
    minInlineElements: 15,
    maxPages: 400,
  },

  /**
   * One name, several resolved types.
   *
   * Deterministic, because the compiler already decided: two declarations of one
   * name that resolve to different printed types ARE two types. The finding is a
   * fact; whether they should be one is the reader's call, and the help names
   * every declaration so the reader can make it.
   */
  oneConceptOneType: {
    /** Findings reported before the rest are counted and not listed. */
    maxFindings: 20,
    /** Characters of a resolved type shown before it is cut. */
    maxTypeChars: 120,
  },

  /**
   * The amplifier: a 5xx answer to a row that is simply not there.
   *
   * A missing row is a normal outcome -- a wrong id, a deleted record -- and
   * answering "the server is broken" turns one bad request into an outage signal.
   * There are no lookup-name lists here on purpose: which calls read a row is a
   * judgement (`about_a_row`), not a name convention, and naming it in code was
   * the classifier's work done ahead of time.
   */
  dataError: {
    /** Handlers judged before the rest are counted and not asked about. */
    maxHandlers: 40,
  },

  /**
   * How much of a cluster is described to the model.
   *
   * A cluster of two hundred declarations is one decision but not one question:
   * sending every member's source blew the request budget and the API answered
   * 400. The first N members are described and the rest are counted, so the
   * decision still stands on the whole cluster even when the detail is bounded.
   */
  evidence: {
    maxMembers: 12,
    maxSourceChars: 1500,
    /** Characters of a doc comment kept as evidence. */
    maxDocChars: 400,
    /** Paths listed in a finding's help before it says "and N more". */
    maxListedPaths: 4,
  },

  /**
   * What a test file looks like.
   *
   * Test files were 24 of 196 findings on one real repository, and the worst of
   * them are not wrong: a factory or a fixture helper is SUPPOSED to be repeated,
   * because that is what makes it a factory. A linter that reports it is
   * reporting the technique. jev carries this regex; joggle had no notion of a
   * test file at all, so a spec's helpers were held to the same standard as an
   * API's.
   */
  testFiles: /(?:^|\/)(?:tests?|__tests__|specs?)(?:\/|$)|\.(?:spec|test)\.[cm]?[jt]sx?$/,

  /**
   * A shared path that discards items and does not say so.
   *
   * `nonDataReturns` is a DECLARED convention: the scalar types that cannot carry
   * the items a caller reads. A function that returns only a flag or nothing does
   * not shorten the caller's data, whatever `continue` it contains -- the review
   * case returns a list, and the false candidate in this repository answers one
   * boolean question. The filter only ever drops a declaration whose every
   * recorded return is one of these; an array, a number or an unknown type stays.
   */
  unaccountedDrop: {
    nonDataReturns: ["void", "undefined", "null", "boolean", "bigint", "symbol", "never"],
  },

  /** Files and directories the workspace scan never enters. */
  ignoredDirectories: [
    "node_modules",
    // Nested checkouts, as this repository keeps them: analysing them as part of
    // the parent repo reports the child's own demo pages as the parent's.
    "repos",
    ".git",
    "dist",
    "build",
    "out",
    "coverage",
    ".next",
    ".turbo",
    ".vercel",
    ".cache",
  ],
} as const

export type Policy = typeof policy
