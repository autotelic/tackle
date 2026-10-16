import { duplicateImplementation } from "./duplicate-implementation.ts"
import { duplicateCallRun } from "./duplicate-call-run.ts"
import { duplicateMeaning } from "./duplicate-meaning.ts"
import { importArchitectureRules } from "./import-architecture.ts"
import { dependencyFit } from "./dependency-fit.ts"
import { docMatchesCode } from "./doc-matches-code.ts"
import { fieldTypeDrift } from "./field-type-drift.ts"
import { languageDrift } from "./language-drift.ts"
import { callPattern } from "./call-pattern.ts"
import { nameAsAddress } from "./name-as-address.ts"
import { moduleDirection } from "./module-direction.ts"
import { objectShape } from "./object-shape.ts"
import { composeTypes } from "./compose-types.ts"
import { nameThePrimitive } from "./name-the-primitive.ts"
import { ruleJudgment } from "./rule-judgment.ts"
import { shallowModule } from "./shallow-module.ts"
import { temporalCoupling } from "./temporal-coupling.ts"
import { hoistToDomain } from "./hoist-to-domain.ts"
import { namingDrift } from "./naming-drift.ts"
import { reimplementedPrimitive } from "./reimplemented-primitive.ts"
import { oneConceptOneType } from "./one-concept-one-type.ts"
import { nullabilityDrift } from "./nullability-drift.ts"
import { dataErrorAsOutage } from "./data-error-as-outage.ts"
import { typesOverLogic } from "./types-over-logic.ts"
import { singlePath } from "./single-path.ts"
import { unaccountedDrop } from "./unaccounted-drop.ts"
import { genericCarriesACaller } from "./generic-carries-a-caller.ts"
import { schemaExcludesDomainValue } from "./schema-excludes-domain-value.ts"
import { meaningSwitchedByFlag } from "./meaning-switched-by-flag.ts"
import { unboundedDefaultRead } from "./unbounded-default-read.ts"
import { inferredOverRecorded } from "./inferred-over-recorded.ts"
import { Context, Layer } from "effect"
import type { PlannedRule, Rule } from "../rule.ts"

/**
 * The registry. Add a rule by writing one file and one line here.
 *
 * The rules that run without being asked for. The composition pattern is not
 * here. It is a preset -- five rules that encode one starter repository's
 * architecture, plus the page rule that judges whether a page follows it. A tool
 * that runs somebody's opinions by default is a tool that gets switched off by
 * the first team whose architecture differs, which is most of them.
 *
 * What is here is either derived from the code under analysis (import direction,
 * cycles, field-set composition) or a question with no architecture in it
 * (duplication, naming drift, undeclared dependencies).
 */
export const allRules: ReadonlyArray<Rule | PlannedRule> = [
  ...importArchitectureRules,
  composeTypes,
  callPattern,
  moduleDirection,
  nameAsAddress,
  objectShape,
  nameThePrimitive,
  ruleJudgment,
  shallowModule,
  temporalCoupling,
  dependencyFit,
  docMatchesCode,
  fieldTypeDrift,
  hoistToDomain,
  languageDrift,
  duplicateCallRun,
  duplicateImplementation,
  duplicateMeaning,
  namingDrift,
  reimplementedPrimitive,
  oneConceptOneType,
  nullabilityDrift,
  dataErrorAsOutage,
  typesOverLogic,
  singlePath,
  unaccountedDrop,
  genericCarriesACaller,
  schemaExcludesDomainValue,
  meaningSwitchedByFlag,
  unboundedDefaultRead,
  inferredOverRecorded,
]

/**
 * The rule set, as a service.
 *
 * A run does not read a hardcoded array; it reads whatever the context provides.
 * That is what lets a preset be a layer, a test provide three rules, and a
 * repository add its own without editing this file.
 */
export class Rules extends Context.Service<Rules, ReadonlyArray<Rule | PlannedRule>>()("@joggle/Rules") {}

/** The built-in rules, as the default `Rules` layer. */
export const builtIn: Layer.Layer<Rules> = Layer.succeed(Rules, allRules)
