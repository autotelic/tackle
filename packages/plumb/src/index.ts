import { eslintCompatPlugin } from "@oxlint/plugins";

import { preferPropertyTestsRule } from "./rules/prefer-property-tests.ts";

import { noChainedTypeAssertionsRule } from "./rules/no-chained-type-assertions.ts";
import { noConditionalEmptyObjectSpreadRule } from "./rules/no-conditional-empty-object-spread.ts";
import { noBooleanFieldSignalsRule } from "./rules/no-boolean-field-signals.ts";
import { noImpossibleBranchThrowRule } from "./rules/no-impossible-branch-throw.ts";
import { noKnownValueWideningRule } from "./rules/no-known-value-widening.ts";
import { noModuleMockingRule } from "./rules/no-module-mocking.ts";
import { noObjectParametersRule } from "./rules/no-object-parameters.ts";
import { noReinterpretCastRule } from "./rules/no-reinterpret-cast.ts";
import { preferPayloadBrandRule } from "./rules/prefer-payload-brand.ts";
import { noProductOfStateBooleansRule } from "./rules/no-product-of-state-booleans.ts";
import { noReflectApplyRule } from "./rules/no-reflect-apply.ts";
import { requireFcBlockPredicateRule } from "./rules/require-fc-block-predicate.ts";
import { requireJsdocOnExportedRule } from "./rules/require-jsdoc-on-exported.ts";
import { requirePublishedOrderRule } from "./rules/require-published-order.ts";
import { noReflectGetRule } from "./rules/no-reflect-get.ts";
import { noRuntimeTypeofRule } from "./rules/no-runtime-typeof.ts";
import { noSentinelComparisonUnionRule } from "./rules/no-sentinel-comparison-union.ts";
import { noStackedJsdocBlocksRule } from "./rules/no-stacked-jsdoc-blocks.ts";
import { noForbiddenTermInSymbolNamesRule } from "./rules/no-shape-in-symbol-names.ts";
import { noUnitReturnValidatorsRule } from "./rules/no-unit-return-validators.ts";
import { noUnknownParametersRule } from "./rules/no-unknown-parameters.ts";
import { noUnknownReturnsRule } from "./rules/no-unknown-returns.ts";
import { noUnknownTypeAliasesRule } from "./rules/no-unknown-type-aliases.ts";
import { noUnsafeDictionaryTypeRule } from "./rules/no-unsafe-dictionary-type.ts";
import { noStrayInlineCommentsRule } from "./rules/no-stray-inline-comments.ts";
import { noWidenThenAssertRule } from "./rules/no-widen-then-assert.ts";
import { requireSafetyCommentForTypeAssertionRule } from "./rules/require-safety-comment-for-type-assertion.ts";
import { requireSortComparatorRule } from "./rules/require-sort-comparator.ts";
import { noGenericExportNamesRule } from "./rules/no-generic-export-names.ts";
import { noBarrelExportStarRule } from "./rules/no-barrel-export-star.ts";
import { requireDeprecatedTagForLegacyCommentsRule } from "./rules/require-deprecated-tag-for-legacy-comments.ts";
import { noVagueTestFilenamesRule } from "./rules/no-vague-test-filenames.ts";
import { noSwappablePrimitiveParamsRule } from "./rules/no-swappable-primitive-params.ts";
import { noTransposedFieldReadsRule } from "./rules/no-transposed-field-reads.ts";
import { noBuiltinThrowsRule } from "./rules/no-builtin-throws.ts";
import { noNondeterministicCoreRule } from "./rules/no-nondeterministic-core.ts";
import { noExportedMutableStateRule } from "./rules/no-exported-mutable-state.ts";
import { noDuplicatedLiteralUnionRule } from "./rules/no-duplicated-literal-union.ts";
import { requireCanonicalStringifyForIdentityRule } from "./rules/require-canonical-stringify-for-identity.ts";
import { noAnonymousWideTuplesRule } from "./rules/no-anonymous-wide-tuples.ts";
import { noTagLadderAssertionsRule } from "./rules/no-tag-ladder-assertions.ts";
import { noRedundantDerivedFieldRule } from "./rules/no-redundant-derived-field.ts";
import { requireExhaustiveTagSwitchRule } from "./rules/require-exhaustive-tag-switch.ts";
import { noMultipleFunctionParamsRule } from "./rules/no-multiple-function-params.ts";
import { noOptionalFunctionParametersRule } from "./rules/no-optional-function-parameters.ts";
import { noSingleUsePrivateFunctionsRule } from "./rules/no-single-use-private-functions.ts";
import { noMutableEnvironmentCaptureRule } from "./rules/no-mutable-environment-capture.ts";
import { noSqlStringInterpolationRule } from "./rules/no-sql-string-interpolation.ts";

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
		"no-sql-string-interpolation": noSqlStringInterpolationRule,
	},
});

export default plumbPlugin;
