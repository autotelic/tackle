import { defineRule } from "@oxlint/plugins";
import { classifyUnsafeDictionary, classifyUnsafeDictionaryValue, createTypeEnvironment, } from "../shared/dictionary-types.js";
import { ancestorsOf } from "../shared/ancestors.js";
const typeNodeKinds = new Set([
    "JSDocNonNullableType",
    "JSDocNullableType",
    "JSDocUnknownType",
    "TSAnyKeyword",
    "TSArrayType",
    "TSBigIntKeyword",
    "TSBooleanKeyword",
    "TSConditionalType",
    "TSConstructorType",
    "TSFunctionType",
    "TSImportType",
    "TSIndexedAccessType",
    "TSInferType",
    "TSIntersectionType",
    "TSIntrinsicKeyword",
    "TSLiteralType",
    "TSMappedType",
    "TSNamedTupleMember",
    "TSNeverKeyword",
    "TSNullKeyword",
    "TSNumberKeyword",
    "TSObjectKeyword",
    "TSParenthesizedType",
    "TSStringKeyword",
    "TSSymbolKeyword",
    "TSTemplateLiteralType",
    "TSThisType",
    "TSTupleType",
    "TSTypeLiteral",
    "TSTypeOperator",
    "TSTypePredicate",
    "TSTypeQuery",
    "TSTypeReference",
    "TSUndefinedKeyword",
    "TSUnionType",
    "TSUnknownKeyword",
    "TSVoidKeyword",
]);
/**
 * Whether a node is one of the grammar's type-node kinds.
 *
 * @param {ESTree.Node} node - The ancestor node to test.
 * @returns {boolean} True when the node is a type node.
 */
function isTypeNode(node) {
    return typeNodeKinds.has(node.type);
}
/** Disallow object-dictionary contracts whose direct value type is an unsafe escape hatch. */
export const noUnsafeDictionaryTypeRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Disallow object-dictionary contracts whose direct value type is unknown, any, object, {}, or a union/alias containing one of those escape hatches.",
        },
        messages: {
            unsafeDictionary: "This dictionary's {{value}} value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.",
        },
    },
    createOnce(context) {
        let environment = null;
        const report = (node, value) => {
            context.report({ node, messageId: "unsafeDictionary", data: { value } });
        };
        const reportIfUnsafe = (node) => {
            if (environment === null)
                return;
            if (node.type === "TSTypeReference" && !node.typeArguments?.params.length) {
                const aliasName = node.typeName.type === "Identifier" ? node.typeName.name : null;
                if (aliasName !== null && environment.aliases.has(aliasName)) {
                    let insideAliasDeclaration = false;
                    for (const current of ancestorsOf(context.sourceCode, node)) {
                        if (current.type === "Program")
                            break;
                        if (current.type === "TSTypeAliasDeclaration") {
                            insideAliasDeclaration = true;
                            break;
                        }
                    }
                    if (!insideAliasDeclaration)
                        return;
                }
            }
            const unsafe = classifyUnsafeDictionary(node, environment);
            if (unsafe === null)
                return;
            for (const current of ancestorsOf(context.sourceCode, node)) {
                if (current.type === "Program")
                    break;
                if (isTypeNode(current) && classifyUnsafeDictionary(current, environment) !== null)
                    return;
            }
            report(node, unsafe.unsafeValue);
        };
        return {
            Program(node) {
                environment = createTypeEnvironment(node);
            },
            TSTypeReference: reportIfUnsafe,
            TSTypeLiteral: reportIfUnsafe,
            TSMappedType: reportIfUnsafe,
            TSIndexSignature(node) {
                if (environment === null ||
                    node.typeAnnotation === null ||
                    ancestorsOf(context.sourceCode, node).at(-1)?.type === "TSTypeLiteral")
                    return;
                const unsafe = classifyUnsafeDictionaryValue(node.typeAnnotation.typeAnnotation, environment);
                if (unsafe !== null)
                    report(node, unsafe.unsafeValue);
            },
        };
    },
});
