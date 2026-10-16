import { isNode } from "./is-node.js";
import { readField } from "../shared/structural.js";
function collectInferTypeParameterNames(node, visitorKeys, names) {
    if (node.type === "TSInferType")
        names.add(node.typeParameter.name.name);
    for (const key of visitorKeys[node.type] ?? []) {
        const value = readField(node, key);
        if (isNode(value)) {
            collectInferTypeParameterNames(value, visitorKeys, names);
            continue;
        }
        if (!Array.isArray(value))
            continue;
        for (const child of value) {
            if (isNode(child))
                collectInferTypeParameterNames(child, visitorKeys, names);
        }
    }
}
/**
 * Collect type binders that are in scope at a node and can shadow module aliases.
 *
 * @param {ESTree.Node} node - The node whose lexical scope is being resolved.
 * @param {ReadonlyArray<ESTree.Node>} ancestors - Nearest-first ancestor chain of `node`.
 * @param {VisitorKeys} visitorKeys - Grammar keys used to descend conditional types.
 * @returns {ReadonlySet<string>} Names of in-scope type binders.
 */
export function lexicalTypeParameterNames(node, ancestors, visitorKeys) {
    const names = new Set();
    const chain = [node, ...[...ancestors].reverse()];
    for (let index = 1; index < chain.length; index += 1) {
        const current = chain[index];
        if (current.type === "Program")
            break;
        const descendant = chain[index - 1];
        if ("typeParameters" in current) {
            for (const parameter of current.typeParameters?.params ?? []) {
                names.add(parameter.name.name);
            }
        }
        if (current.type === "TSMappedType" &&
            (descendant === current.nameType || descendant === current.typeAnnotation)) {
            names.add(current.key.name);
        }
        if (current.type === "TSConditionalType" && descendant === current.trueType) {
            collectInferTypeParameterNames(current.extendsType, visitorKeys, names);
        }
    }
    return names;
}
