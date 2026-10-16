import { eslintCompatPlugin } from "@oxlint/plugins";
import { guardedOpMustReturnEffectRule } from "./rules/guarded-op-must-return-effect.js";
import { guardedOpMustReturnOptionRule } from "./rules/guarded-op-must-return-option.js";
import { noDecodeUnknownOptionRule } from "./rules/no-decode-unknown-option.js";
import { noManualFieldGuardsRule } from "./rules/no-manual-field-guards.js";
import { noUnguardedJsonParseRule } from "./rules/no-unguarded-json-parse.js";
import { noSchemaClassModelingRule } from "./rules/no-schema-class-modeling.js";
import { noServiceConstructorImportsRule } from "./rules/no-service-constructor-imports.js";
import { optionCoreNeedsEffectPublicRule } from "./rules/option-core-needs-effect-public.js";
import { preferDieForPreconditionDefectsRule } from "./rules/prefer-die-for-precondition-defects.js";
import { preferEffectGenForGuardLaddersRule } from "./rules/prefer-effect-gen-for-guard-ladders.js";
import { preferEffectPredicateOverBooleanFunctionRule } from "./rules/prefer-effect-predicate-over-boolean-function.js";
import { preferNamedGuardPredicateRule } from "./rules/prefer-named-guard-predicate.js";
import { preferOrderingMatchRule } from "./rules/prefer-ordering-match.js";
import { preferOptionPipelineRule } from "./rules/prefer-option-pipeline.js";
import { preferTaggedEnumRule } from "./rules/prefer-tagged-enum.js";
import { requireSchemaTypeDerivationRule } from "./rules/require-schema-type-derivation.js";
import { noDirectFetchRule } from "./rules/no-direct-fetch.js";
import { noDirectBrowserStorageRule } from "./rules/no-direct-browser-storage.js";
import { noTryCatchRule } from "./rules/no-try-catch.js";
import { noSilentErrorSwallowRule } from "./rules/no-silent-error-swallow.js";
import { preferEffectMatchRule } from "./rules/prefer-effect-match.js";
import { noNestedLayerProvideRule } from "./rules/no-nested-layer-provide.js";
import { noCascadingLayerProvideRule } from "./rules/no-cascading-layer-provide.js";
import { noStaticEffectServiceForwardersRule } from "./rules/no-static-effect-service-forwarders.js";
/** Opt-in Oxlint rules for Effect service and Layer architecture. */
const plumbEffectPlugin = eslintCompatPlugin({
    meta: { name: "plumb-effect" },
    rules: {
        "guarded-op-must-return-effect": guardedOpMustReturnEffectRule,
        "guarded-op-must-return-option": guardedOpMustReturnOptionRule,
        "no-decode-unknown-option": noDecodeUnknownOptionRule,
        "no-manual-field-guards": noManualFieldGuardsRule,
        "no-unguarded-json-parse": noUnguardedJsonParseRule,
        "option-core-needs-effect-public": optionCoreNeedsEffectPublicRule,
        "no-schema-class-modeling": noSchemaClassModelingRule,
        "no-service-constructor-imports": noServiceConstructorImportsRule,
        "prefer-die-for-precondition-defects": preferDieForPreconditionDefectsRule,
        "prefer-effect-gen-for-guard-ladders": preferEffectGenForGuardLaddersRule,
        "prefer-effect-predicate-over-boolean-function": preferEffectPredicateOverBooleanFunctionRule,
        "prefer-named-guard-predicate": preferNamedGuardPredicateRule,
        "prefer-option-pipeline": preferOptionPipelineRule,
        "prefer-ordering-match": preferOrderingMatchRule,
        "prefer-tagged-enum": preferTaggedEnumRule,
        "require-schema-type-derivation": requireSchemaTypeDerivationRule,
        "no-direct-fetch": noDirectFetchRule,
        "no-direct-browser-storage": noDirectBrowserStorageRule,
        "no-try-catch": noTryCatchRule,
        "no-silent-error-swallow": noSilentErrorSwallowRule,
        "prefer-effect-match": preferEffectMatchRule,
        "no-nested-layer-provide": noNestedLayerProvideRule,
        "no-cascading-layer-provide": noCascadingLayerProvideRule,
        "no-static-effect-service-forwarders": noStaticEffectServiceForwardersRule,
    },
});
export default plumbEffectPlugin;
