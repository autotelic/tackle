import { eslintCompatPlugin } from "@oxlint/plugins";
import { preferPropertyTestsRule } from "./rules/prefer-property-tests.js";
import { noChainedTypeAssertionsRule } from "./rules/no-chained-type-assertions.js";
import { noConditionalEmptyObjectSpreadRule } from "./rules/no-conditional-empty-object-spread.js";
import { noBooleanFieldSignalsRule } from "./rules/no-boolean-field-signals.js";
import { noImpossibleBranchThrowRule } from "./rules/no-impossible-branch-throw.js";
import { noKnownValueWideningRule } from "./rules/no-known-value-widening.js";
import { noModuleMockingRule } from "./rules/no-module-mocking.js";
import { noObjectParametersRule } from "./rules/no-object-parameters.js";
import { noReinterpretCastRule } from "./rules/no-reinterpret-cast.js";
import { preferPayloadBrandRule } from "./rules/prefer-payload-brand.js";
import { noProductOfStateBooleansRule } from "./rules/no-product-of-state-booleans.js";
import { noReflectApplyRule } from "./rules/no-reflect-apply.js";
import { requireFcBlockPredicateRule } from "./rules/require-fc-block-predicate.js";
import { requireJsdocOnExportedRule } from "./rules/require-jsdoc-on-exported.js";
import { requirePublishedOrderRule } from "./rules/require-published-order.js";
import { noReflectGetRule } from "./rules/no-reflect-get.js";
import { noRuntimeTypeofRule } from "./rules/no-runtime-typeof.js";
import { noSentinelComparisonUnionRule } from "./rules/no-sentinel-comparison-union.js";
import { noStackedJsdocBlocksRule } from "./rules/no-stacked-jsdoc-blocks.js";
import { noForbiddenTermInSymbolNamesRule } from "./rules/no-shape-in-symbol-names.js";
import { noUnitReturnValidatorsRule } from "./rules/no-unit-return-validators.js";
import { noUnknownParametersRule } from "./rules/no-unknown-parameters.js";
import { noUnknownReturnsRule } from "./rules/no-unknown-returns.js";
import { noUnknownTypeAliasesRule } from "./rules/no-unknown-type-aliases.js";
import { noUnsafeDictionaryTypeRule } from "./rules/no-unsafe-dictionary-type.js";
import { noStrayInlineCommentsRule } from "./rules/no-stray-inline-comments.js";
import { noWidenThenAssertRule } from "./rules/no-widen-then-assert.js";
import { requireSafetyCommentForTypeAssertionRule } from "./rules/require-safety-comment-for-type-assertion.js";
import { requireSortComparatorRule } from "./rules/require-sort-comparator.js";
import { noGenericExportNamesRule } from "./rules/no-generic-export-names.js";
import { noBarrelExportStarRule } from "./rules/no-barrel-export-star.js";
import { requireDeprecatedTagForLegacyCommentsRule } from "./rules/require-deprecated-tag-for-legacy-comments.js";
import { noVagueTestFilenamesRule } from "./rules/no-vague-test-filenames.js";
import { noSwappablePrimitiveParamsRule } from "./rules/no-swappable-primitive-params.js";
import { noTransposedFieldReadsRule } from "./rules/no-transposed-field-reads.js";
import { noBuiltinThrowsRule } from "./rules/no-builtin-throws.js";
import { noNondeterministicCoreRule } from "./rules/no-nondeterministic-core.js";
import { noExportedMutableStateRule } from "./rules/no-exported-mutable-state.js";
import { noDuplicatedLiteralUnionRule } from "./rules/no-duplicated-literal-union.js";
import { requireCanonicalStringifyForIdentityRule } from "./rules/require-canonical-stringify-for-identity.js";
import { noAnonymousWideTuplesRule } from "./rules/no-anonymous-wide-tuples.js";
import { noTagLadderAssertionsRule } from "./rules/no-tag-ladder-assertions.js";
import { noRedundantDerivedFieldRule } from "./rules/no-redundant-derived-field.js";
import { requireExhaustiveTagSwitchRule } from "./rules/require-exhaustive-tag-switch.js";
import { noMultipleFunctionParamsRule } from "./rules/no-multiple-function-params.js";
import { noOptionalFunctionParametersRule } from "./rules/no-optional-function-parameters.js";
import { noSingleUsePrivateFunctionsRule } from "./rules/no-single-use-private-functions.js";
import { noMutableEnvironmentCaptureRule } from "./rules/no-mutable-environment-capture.js";
/** Generic Oxlint rules that reject low-evidence and low-signal implementation patterns. */
const plumbPlugin = eslintCompatPlugin({
    meta: { name: "plumb" },
    rules: {
        "no-chained-type-assertions": noChainedTypeAssertionsRule,
        "no-boolean-field-signals": noBooleanFieldSignalsRule,
        "no-conditional-empty-object-spread": noConditionalEmptyObjectSpreadRule,
        "no-impossible-branch-throw": noImpossibleBranchThrowRule,
        "no-known-value-widening": noKnownValueWideningRule,
        "no-module-mocking": noModuleMockingRule,
        "no-object-parameters": noObjectParametersRule,
        "no-reinterpret-cast": noReinterpretCastRule,
        "prefer-payload-brand": preferPayloadBrandRule,
        "no-product-of-state-booleans": noProductOfStateBooleansRule,
        "no-reflect-apply": noReflectApplyRule,
        "require-published-order": requirePublishedOrderRule,
        "no-reflect-get": noReflectGetRule,
        "no-runtime-typeof": noRuntimeTypeofRule,
        "no-sentinel-comparison-union": noSentinelComparisonUnionRule,
        "no-stacked-jsdoc-blocks": noStackedJsdocBlocksRule,
        "no-stray-inline-comments": noStrayInlineCommentsRule,
        "no-unit-return-validators": noUnitReturnValidatorsRule,
        "no-unsafe-dictionary-type": noUnsafeDictionaryTypeRule,
        "no-shape-in-symbol-names": noForbiddenTermInSymbolNamesRule,
        "no-unknown-parameters": noUnknownParametersRule,
        "no-unknown-returns": noUnknownReturnsRule,
        "no-unknown-type-aliases": noUnknownTypeAliasesRule,
        "no-widen-then-assert": noWidenThenAssertRule,
        "require-fc-block-predicate": requireFcBlockPredicateRule,
        "require-jsdoc-on-exported": requireJsdocOnExportedRule,
        "require-safety-comment-for-type-assertion": requireSafetyCommentForTypeAssertionRule,
        "require-sort-comparator": requireSortComparatorRule,
        "no-generic-export-names": noGenericExportNamesRule,
        "no-barrel-export-star": noBarrelExportStarRule,
        "require-deprecated-tag-for-legacy-comments": requireDeprecatedTagForLegacyCommentsRule,
        "no-vague-test-filenames": noVagueTestFilenamesRule,
        "no-swappable-primitive-params": noSwappablePrimitiveParamsRule,
        "no-transposed-field-reads": noTransposedFieldReadsRule,
        "no-builtin-throws": noBuiltinThrowsRule,
        "no-nondeterministic-core": noNondeterministicCoreRule,
        "no-exported-mutable-state": noExportedMutableStateRule,
        "no-tag-ladder-assertions": noTagLadderAssertionsRule,
        "no-anonymous-wide-tuples": noAnonymousWideTuplesRule,
        "no-duplicated-literal-union": noDuplicatedLiteralUnionRule,
        "require-canonical-stringify-for-identity": requireCanonicalStringifyForIdentityRule,
        "no-redundant-derived-field": noRedundantDerivedFieldRule,
        "require-exhaustive-tag-switch": requireExhaustiveTagSwitchRule,
        "prefer-property-tests": preferPropertyTestsRule,
        "no-multiple-function-params": noMultipleFunctionParamsRule,
        "no-optional-function-parameters": noOptionalFunctionParametersRule,
        "no-single-use-private-functions": noSingleUsePrivateFunctionsRule,
        "no-mutable-environment-capture": noMutableEnvironmentCaptureRule,
    },
});
export default plumbPlugin;
