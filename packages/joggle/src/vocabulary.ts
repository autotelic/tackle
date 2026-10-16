import { Schema } from "effect"
import { Decision } from "effect/unstable/ai"

/*
 * Every word the model is asked to choose between, in one file.
 *
 * jev keeps its thresholds AND its whole vocabulary in a config module with no
 * imports: five dimensions, thirty mechanism strings, four rubric levels. Tuning
 * that system is editing data. joggle had the thresholds in policy.ts and the
 * vocabulary scattered through the rules that used them, which meant the only way
 * to compare two questions was to read two files -- and comparing them side by
 * side is exactly how you notice that one of them has no way to say "this is
 * fine", which is the bug the previous commit fixed.
 *
 * The split is by whether a string depends on the candidate. A string that is the
 * same for every candidate lives here. A criterion that names the member being
 * kept, or counts the declarations shown, is built in the rule that knows those
 * facts -- so the WORDS still come from here, through a template.
 */

/** The shared question for exact and near duplicates. */
export const duplicateVocabulary = {
  redundant: {
    true: "One declaration would serve better than several.",
    false: "The repetition is justified.",
  },
  /**
   * What a declaration IS, which decides what to do about it being duplicated.
   *
   * The same duplication has opposite prescriptions depending on this answer and
   * nothing else. A wire contract defined on both sides of a service boundary is
   * correct -- two independently deployed services share a shape, not a module. A
   * domain concept defined on both sides is the defect the whole architecture
   * exists to prevent. The paths say which; the model is the thing that can tell.
   */
  role: {
    wire_contract:
      "A shape that crosses a process or protocol boundary: a request body, a response, a serialized record.",
    domain_concept:
      "A thing the business has an opinion about, with rules or meaning attached to it.",
    implementation_detail:
      "A helper that exists to make other code work, and means nothing on its own.",
    framework_glue:
      "A shape a framework requires, such as route props, loader data, or a config object.",
  },
  /**
   * How the files holding the copies relate, which decides whether any of them
   * can import the others.
   *
   * This is what a declared layering used to be asked for. It is inferable from
   * the paths and the import graph, and it is genuinely fuzzy at the edges -- is
   * `app/routes/finance/x` a sibling of `app/routes/payroll/y` or in the same
   * module? -- which is exactly the shape of question worth asking.
   */
  relationship: {
    same_module: "One directory, or one feature: they are edited together.",
    same_package: "One deployable, different features.",
    sibling_packages: "Different packages inside one repository, able to depend on each other.",
    different_deployables:
      "Separately deployed services. Neither may import the other, whatever their paths suggest.",
  },
  /**
   * How much it MATTERS, which is a different question from whether it is true.
   *
   * The report used to sort by redundancy -- "are these one thing?" -- and on one
   * repository that put the lowest score in the whole report on a spec that
   * re-implements the function it tests, while three placeholder aliases that
   * were all `any` sat above it at 0.68. Both answers were correct. Sorting by
   * the answer to the wrong question is how a real finding ends up last.
   *
   * A Score, not a Noul, because "would a reader be better off" is a degree and a
   * Noul throws the degree away: 0.55 and 0.95 both mean yes, and the report
   * sorts on this answer, so the degree is the thing that was wanted. The levels
   * are ordered lowest to highest. Their descriptions live in the question's
   * instructions, because a Rate's criteria ARE the level names.
   */
  consequenceLevels: [
    "no_difference",
    "slightly_clearer",
    "meaningfully_better",
    "removes_a_hazard",
  ],
  /**
   * What the DIFFERENCE between two near-identical declarations is.
   *
   * This is the question that separates a merge from a move, and nothing asked it
   * before: `role` says what a declaration is, and `relationship` says where the
   * files sit, and neither says whether the thing that differs between the copies
   * is a value or a meaning.
   */
  difference: {
    value: "The same thing with a different constant, option or parameter, so one could take the other's.",
    meaning: "A different concept that happens to read alike.",
    unclear: "The evidence does not say.",
  },
  /**
   * What to DO about it, asked rather than tabulated.
   *
   * `prescriptionFor` was a table over `(role, relationship)`, and a table over
   * two answers is the code deciding an order the model can decide in one
   * question. It is asked instead, with the facts the table used to encode as
   * STATE rather than as branches: the operations the import graph permits are
   * already computed, so the options are the ones that can actually happen.
   */
  prescription: {
    merge:
      "Delete the copies and import one. These files can reach each other, so the survivor is available to all of them.",
    move:
      "The shared part belongs somewhere every copy can depend on. Move it there and import it from each site.",
    split: "One name with two meanings. Give each meaning its own name and declaration.",
    share_a_contract:
      "Expected duplication across a deployable boundary. Give both sides one shared contracts package if they must agree, and leave it alone if they must not.",
    leave_it:
      "Framework shapes and stable copies that nobody will change. Leave them as they are.",
  },
  verdict: {
    collapse: "They are one thing. Keep one of them and delete the rest.",
    keep_variants:
      "Related but deliberately separate, such as a special case of a general routine. Keep them all.",
    no_issue: "Coincidentally similar. They are different things. Change nothing.",
  },
} as const

/** Name pairs: two spellings of one concept, or two different concepts. */
export const nameVocabulary = {
  oneConcept: {
    true: "One concept, so one name should go.",
    false: "Two concepts, so both names are correct.",
  },
  /**
   * The two "one concept" options differ only in WHICH name survives, so the
   * sentence is one template and the rule supplies the symbol.
   */
  standardize: (symbol: string): string =>
    "One concept, two spellings. Standardize on `" + symbol + "`.",
  noIssue: "Two different concepts. Both names are correct. Change nothing.",
} as const

/**
 * What "extract this into a bundle" means, per kind of file.
 *
 * This is the `mechanisms[dimension]` shape from the TypeSafe docs: the first
 * question's ANSWER selects the OPTIONS of the second. A route page and a modal
 * are both worth asking about, but a bundle means a different thing to each -- a
 * route owns a screen and its navigation state, a modal owns one interaction and
 * its dismissal. Asking both with one vocabulary is how a question gets an answer
 * that is true of neither.
 */
export const pageVerdictByRole: Record<string, Record<string, string>> = {
  route_page: {
    extract_to_bundle:
      "Its state and its screen-wide pieces belong in a bundle with `{ state, actions, meta }`, exported by dot notation.",
    extract_some:
      "Part of it does, such as the panel that always travels with the data it reads.",
    no_issue:
      "No. This page's state is genuinely its own and a provider would be ceremony between it and its children.",
  },
  modal: {
    extract_to_bundle:
      "Its draft state and its steps belong in a bundle, so the form and its actions are not threaded through each step.",
    extract_some:
      "Part of it does, such as the step controls that repeat per field.",
    no_issue:
      "No. A modal with one piece of state and one submit needs no provider to share anything.",
  },
  layout: {
    extract_to_bundle:
      "It owns state that its children read, which is a bundle's job rather than a layout's.",
    extract_some:
      "Part of it does, such as the chrome that several children configure.",
    no_issue: "No. A layout that renders children and owns nothing is exactly what a layout should be.",
  },
}

/**
 * What a module is FOR, asked once per module rather than once per declaration.
 *
 * The same classification-first move as the page rule and the dependency check,
 * one level up: "business logic at the edge" only means something at an edge, so
 * the first question is whether this is one. On one repository this separated
 * 1,259 declarations into the modules that could contain a hoist candidate and the
 * modules that could not, and it gives every later question the context it was
 * previously missing.
 */
export const moduleRoles = {
  domain_core:
    "The rules and shapes the business is about. Other modules depend on it and it depends on nothing internal.",
  transport_edge:
    "HTTP: handlers, routes, request parsing, response shaping, status codes.",
  rendering_edge: "A user interface: components, routes, forms, view state.",
  infrastructure:
    "A database, a queue, a mail sender, or a client for a third party.",
  /**
   * The machinery of the tool or library itself.
   *
   * Added because running joggle against its own source put `check.ts`,
   * `report.ts`, `decision.ts` and `rule.ts` in `not_applicable` -- the bucket meant
   * for tests, scripts and configuration. Nothing should be hoisted out of an
   * engine either, so the outcome was right, but it was right by accident: the
   * model reached for the nearest option because the vocabulary had none for a
   * repository that IS the application. `not_applicable` is where a mistake hides,
   * since a declaration wrongly put there is silently never a candidate.
   */
  library_core:
    "The machinery of this tool or library itself, which exists to serve code outside it.",
  utilities: "Generic helpers that would make sense in any codebase.",
  not_applicable: "Tests, scripts, migrations, seeds or configuration.",
}

/**
 * Which roles are edges, for the rules that ask "is this the outer layer?".
 *
 * `EDGE_ROLES` was a constant set, and it is the same defect `roleRank` had: it
 * hardcodes that transport and rendering are the outer layer. With a rank in
 * hand it is derivable -- an edge is the highest layer this repository has --
 * and a rule that needs the set builds it from the answer.
 */
export const edgeRolesOf = (ranks: ReadonlyMap<string, number>): ReadonlySet<string> => {
  let top = Number.NEGATIVE_INFINITY
  for (const rank of ranks.values()) if (rank > top) top = rank
  const edges = new Set<string>()
  for (const [role, rank] of ranks) if (rank === top) edges.add(role)
  return edges
}

/**
 * Whether a module can hold a declaration that has crept out of the core.
 *
 * The constant, kept for the vocabulary's own tests and as the fallback a rule
 * uses when no rank was decided. A rule with ranks should call `edgeRolesOf`.
 */
export const EDGE_ROLES: ReadonlySet<string> = new Set(["transport_edge", "rendering_edge"])

/** The rank a role label means, for the arithmetic. */
export const rankOfLabel: Readonly<Record<string, number>> = {
  utilities: 0,
  // A module the run could not classify still occupies a layer; the helpers and
  // third-party clients that nothing internal depends on sit at the bottom.
  below_everything: 0,
  infrastructure: 1,
  // The machinery of a tool or library sits at its own repository's level.
  derives_from: 2,
  domain_core: 2,
  library_core: 2,
  domain: 2,
  transport_edge: 3,
  rendering_edge: 3,
}

/**
 * The layer ordering, as data the rules read.
 *
 * `rankOf(role)` is the model's answer written back into one number, which is
 * the same shape `roleRank` had -- except the table is now the labels, and the
 * answer comes from the repository rather than from this file.
 */
export const rankOf = (label: string): number | undefined => rankOfLabel[label]

/**
 * The rank question, whole.
 *
 * Lives here rather than in `roles.ts` because every string a model is asked to
 * choose between belongs in one file -- the same reason the rest of this module
 * exists.
 */
const RankEvidence = Schema.Struct({
  repository: Schema.optionalKey(Schema.String),
  roles: Schema.Array(Schema.String),
})

export const RoleRanking = Decision.make({
  input: RankEvidence,
  decisions: {
    order: Decision.classify({
      instructions: [
        "Put the roles in `roles` in this codebase's dependency order, lowest first.",
        "A module in a lower layer must never depend on a module in a higher one.",
        "The lowest layer holds things everything else may use: generic helpers and third-party clients.",
        "Above that sits the domain: the rules and shapes the business is about.",
        "Above the domain sit the edges: HTTP that calls it and UI that renders it.",
        "`library_core` is the machinery of a tool or library; place it where this repository's engine actually sits.",
        "`not_applicable` is outside the order: tests, scripts and configuration are not part of it.",
        "Choose the option whose description names the role that should sit LOWEST in this repository.",
      ].join("\n"),
      criteria: Object.fromEntries(
        Object.entries(moduleRoles).map(([role, description]) => [role, description]),
      ),
    }),
  },
})

/** The order, for the note. */
export const layerOrder: ReadonlyArray<string> = [
  "utilities",
  "infrastructure",
  "domain_core",
  "transport_edge",
]

/**
 * What a declaration is doing, which decides whether its location is a problem.
 *
 * The same distinction the duplicate rule needs, one level up. A calculation is a
 * domain rule in any file; a status code is a transport concern in any file. The
 * model is asked what the thing IS, and the code decides whether that is where it
 * belongs.
 */
export const dutyVocabulary = {
  domain_logic:
    "A rule, invariant or calculation about the business: something that would be true of the company even if this software were rewritten.",
  request_validation:
    "A rule about what the endpoint will ACCEPT: which fields are required, which values are in range, which options are mutually exclusive, and what earns a 400. It constrains the transport contract, not the business, and the same endpoint's UI may hold a different set of rules.",
  input_adaptation:
    "Reshaping input into what another layer expects: mapping database columns or a form's fields onto a domain schema. The rule is the domain's; this only converts.",
  mechanical:
    "A cache key, an identifier, a lookup table or a memoisation argument: a value that exists to make other code fast or addressable, with no business meaning.",
  transport_concern:
    "Parsing a request, shaping a response, choosing a status code, or reading a header.",
  rendering: "Producing markup, or preparing data purely for display.",
  orchestration: "Calling other things in order, owning no rules of its own.",
  infrastructure:
    "Talking to a database, a queue, a file system or a third-party service. A function that takes a database handle -- Knex, a transaction, a connection -- is infrastructure however much business logic it reads out of rows: the domain is pure by design, so moving the query into it is the wrong repair.",
  not_applicable: "None of these: a helper with no meaning outside its immediate caller.",
} as const

/**
 * Whether a 5xx is the right answer to a row that is not there.
 *
 * The amplifier the nullability work cannot see: the data is legitimately
 * absent, and the endpoint reports a server outage for it. One question, three
 * options, and the code reads the answer -- which is what Jev is for.
 */
export const dataErrorVocabulary = {
  row_absence_is_normal:
    "The row being absent, or its data being undecodable, is a normal outcome for this request. A 5xx tells the caller the server is broken when it is not: it should be a 404, an empty list, or a 4xx the caller caused.",
  row_absence_is_an_error:
    "The failure is a genuine server fault, or an empty row here means data that must exist does not, so a 5xx is honest.",
  not_applicable: "The branch is not about a row's absence.",
} as const

/**
 * Whether a file is already where logic like this belongs.
 *
 * The question a declared `domain` layer would have answered. Asked instead of
 * configured, so a repository that has not written its layering down still gets
 * an answer -- and one that HAS written it down can pin this decision later.
 */
export const homeVocabulary = {
  already_there: "Yes: this is a domain or model package, which is where rules live.",
  route_or_handler:
    "No: a route, a handler or an HTTP edge, which should be calling a rule rather than containing one.",
  component_or_feature:
    "No: a component or feature directory, which should be rendering a rule's answer rather than deciding it.",
  not_applicable: "Cannot tell from the path.",
} as const

/**
 * Whether a dependency fits what a module is for.
 *
 * Its own export rather than a corner of another purpose's vocabulary, because
 * this rule is its own opinion: a repository that enables duplication checks and
 * not this one should never see these words.
 */
export const dependencyVocabulary = {
  belongs: "This dependency fits what this module is for.",
  framework_expected: "This module is exactly where that framework belongs.",
  violates: "This module should not depend on that, and the architecture says why.",
} as const

/**
 * The page rule's decisions, whole.
 *
 * Every string here is fixed, so there is nothing to build per candidate and
 * nothing to keep in the rule.
 */
export const pageDecisions = {
  role: Decision.classify({
    instructions: [
      "What kind of file is `page.path`?",
      "Classify the file by what it is, not by whether it conforms. This answer decides which question is asked next, so a wrong classification wastes the rest of the request.",
      "Choose \"not_applicable\" when it is none of these.",
    ].join("\n"),
    criteria: {
      route_page: "A route's own page: it owns layout and state for one screen.",
      modal:
        "A dialog or modal: it owns state for one interaction and is opened and closed rather than navigated to.",
      layout: "A shell that renders children and owns little or no state of its own.",
      not_applicable:
        "A helper, a loader, a test, or something else this pattern does not apply to.",
    },
  }),
  verdict: Decision.classify({
    instructions: [
      "Should this file's state and markup live in a composition bundle instead?",
      "Inspect `page`.",
      "The pattern earns its keep when several blocks share state that this file currently threads itself. A file with its own state and no sharing between pieces does not need it.",
      "Judge whether a bundle would remove real duplication of state, not whether this file is long.",
      "Choose `no_issue` when the state is this file's own and nothing is shared.",
    ].join("\n"),
    criteria: {
      extract_to_bundle:
        "Its state and its pieces belong in a bundle with `{ state, actions, meta }`, exported by dot notation.",
      extract_some:
        "Part of it does, such as a repeated block or a group of elements that always travel together.",
      no_issue: "No. The state is genuinely this file's own and a provider would be ceremony.",
    },
  }),
  primary_gap: Decision.classify({
    instructions: [
      "What is the single most useful thing to change about `page.path`?",
      "Name the gap a reviewer would fix first, or `no_issue` when there is nothing to fix.",
      "Choose `no_issue` when there is nothing to fix.",
    ].join("\n"),
    criteria: {
      state_belongs_in_provider: "State threaded here belongs in a provider the pieces read directly.",
      markup_belongs_in_blocks: "Markup inlined here belongs in named blocks, one per file.",
      no_provider_root: "It needs the bundle's provider at its composition root.",
      no_issue: "Nothing; leave this page as it is.",
    },
  }),
  worth_fixing: Decision.probability({
    instructions:
      "Is extracting a bundle from this page worth a reviewer's time? A page that works and shares nothing is not worth restructuring for its own sake.",
    criteria: {
      false: "Leave it alone.",
      true: "A reviewer should look at this.",
    },
  }),
}
