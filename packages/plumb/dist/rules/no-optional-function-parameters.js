import { defineRule } from "@oxlint/plugins";
const TEST_FILE = /.(?:test|spec).[cm]?[jt]sx?$/u;
/**
 * Optional parameters hide undefined from the signature; require the union spelled out.
 *
 * Optionality is a grammar-level flag present on every concrete ParamPattern
 * shape, read after unwrapping TypeScript parameter-property wrappers.
 */
export const noOptionalFunctionParametersRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Disallow optional function parameters (`param?:`); require an explicit union with undefined so callers see the possibility in the type.",
        },
        messages: {
            optionalParameter: "Optional parameters hide `undefined` from callers. Annotate the parameter as `T | undefined` so the possibility is spelled out in the type.",
        },
    },
    createOnce(context) {
        const check = (node) => {
            if (node.type !== "FunctionDeclaration" &&
                node.type !== "FunctionExpression" &&
                node.type !== "ArrowFunctionExpression")
                return;
            for (const parameter of node.params) {
                let pattern = parameter;
                if (pattern.type === "TSParameterProperty")
                    pattern = pattern.parameter;
                if (pattern.optional !== true)
                    continue;
                context.report({ node: parameter, messageId: "optionalParameter" });
            }
        };
        return {
            before() {
                if (TEST_FILE.test(context.filename.replaceAll("\\", "/")))
                    return false;
            },
            FunctionDeclaration: check,
            FunctionExpression: check,
            ArrowFunctionExpression: check,
        };
    },
});
