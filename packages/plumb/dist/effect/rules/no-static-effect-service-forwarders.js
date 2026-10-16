import { defineRule } from "@oxlint/plugins";
import { ancestorsOf } from "../../shared/ancestors.js";
import { isString } from "../../shared/structural.js";
const TEST_FILE = /.(?:test|spec).[cm]?[jt]sx?$|\/test\//u;
/** Computed or plain property name on a member expression.
 *
 * @param {ESTree.MemberExpression} member - The member expression node.
 * @returns {string | null} The property name, or null when unavailable.
 */
function memberName(member) {
    if (!member.computed) {
        return member.property.type === "Identifier" ? member.property.name : null;
    }
    if (member.property.type === "Literal" && isString(member.property.value)) {
        return member.property.value;
    }
    return null;
}
/** Imported name behind an import specifier, for both plain and string-literal spellings.
 *
 * @param {ESTree.Node} specifier - The import specifier node.
 * @returns {string | undefined} The imported name, if any.
 */
function importedNameOf(specifier) {
    if (specifier.type !== "ImportSpecifier")
        return undefined;
    return specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value;
}
/** Local binding name of an import specifier.
 *
 * @param {ESTree.Node} specifier - The import specifier node.
 * @returns {string | undefined} The local bound name, if any.
 */
function localNameOf(specifier) {
    return specifier.type === "ImportSpecifier" || specifier.type === "ImportNamespaceSpecifier"
        ? specifier.local.name
        : undefined;
}
/** Whether the call site sits inside a `static` class property initializer.
 *
 * @param {SourceCode} sourceCode - The rule's source-code accessor.
 * @param {ESTree.Node} node - The call expression being visited.
 * @returns {boolean} True when enclosed by a static property definition.
 */
function inStaticClassField(sourceCode, node) {
    for (const current of ancestorsOf(sourceCode, node)) {
        if (current.type === "PropertyDefinition")
            return current.static === true;
        if (current.type === "Program")
            return false;
    }
    return false;
}
/**
 * Single-parameter handler whose body is one expression or one return statement.
 *
 * @param {ESTree.Node} node - The candidate callback function node.
 * @returns {CallbackExpression | undefined} The extracted expression and parameter, if matching.
 */
function callbackExpression(node) {
    if (node.type !== "ArrowFunctionExpression" && node.type !== "FunctionExpression")
        return undefined;
    if (node.params.length !== 1)
        return undefined;
    const parameter = node.params[0];
    if (parameter.type !== "Identifier")
        return undefined;
    const parameterName = parameter.name;
    if (node.body === null)
        return undefined;
    let body = node.body;
    if (body.type === "BlockStatement") {
        if (body.body.length !== 1)
            return undefined;
        const statement = body.body[0];
        if (statement.type !== "ReturnStatement")
            return undefined;
        if (statement.argument === null || statement.argument === undefined)
            return undefined;
        body = statement.argument;
    }
    return { expression: body, parameterName };
}
/** `svc.member(...)` or bare `svc.member`, where `svc` is exactly the acquired service.
 *
 * @param {ESTree.Expression} expression - The forwarded callback expression.
 * @param {string | undefined} parameterName - The acquired service parameter name.
 * @returns {boolean} True when the expression only reads that service's member.
 */
function isDirectParameterMember(expression, parameterName) {
    if (parameterName === undefined)
        return false;
    const member = expression.type === "CallExpression" ? expression.callee : expression;
    if (member.type !== "MemberExpression")
        return false;
    return member.object.type === "Identifier" && member.object.name === parameterName;
}
/** Static forwarders alias a service method at module scope; acquire the service where its method is used instead.
 *
 * Import tracking covers local names bound by imports of "effect" and
 * "effect/Effect"; re-exports are not tracked.
 */
export const noStaticEffectServiceForwardersRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Disallow static class-field forwarders around Effect services; yield the service at the usage site and call the method directly so dependencies stay explicit.",
        },
        messages: {
            staticForwarder: "This static field forwards an Effect service method. Acquire the service where the method is used (`Effect.flatMap(Service, (svc) => ...)`) so the dependency stays explicit and testable.",
        },
    },
    createOnce(context) {
        const effectNamespaceNames = new Set();
        const flatMapNames = new Set();
        const serviceNames = new Set();
        const pipeNames = new Set();
        const isEffectCall = (node, method, directNames) => {
            if (node.type !== "CallExpression")
                return false;
            const callee = node.callee;
            if (callee.type === "Identifier") {
                return directNames.has(callee.name);
            }
            if (callee.type !== "MemberExpression")
                return false;
            return (callee.object.type === "Identifier" &&
                effectNamespaceNames.has(callee.object.name) &&
                memberName(callee) === method);
        };
        const isServiceAcquisition = (node) => {
            if (!isEffectCall(node, "service", serviceNames))
                return false;
            return node.arguments.length === 1 && node.arguments[0].type === "ThisExpression";
        };
        const isForwardingFlatMap = (node) => {
            if (!isEffectCall(node, "flatMap", flatMapNames))
                return false;
            const last = node.arguments[node.arguments.length - 1];
            if (last === undefined)
                return false;
            const callback = callbackExpression(last);
            if (callback === undefined)
                return false;
            return isDirectParameterMember(callback.expression, callback.parameterName);
        };
        return {
            before() {
                if (TEST_FILE.test(context.filename.replaceAll("\\", "/")))
                    return false;
            },
            ImportDeclaration(node) {
                if (node.source.value === "effect") {
                    for (const specifier of node.specifiers) {
                        const local = localNameOf(specifier);
                        if (local === undefined)
                            continue;
                        if (specifier.type === "ImportNamespaceSpecifier")
                            effectNamespaceNames.add(local);
                        const imported = importedNameOf(specifier);
                        if (specifier.type === "ImportSpecifier" && imported === "Effect") {
                            effectNamespaceNames.add(local);
                        }
                        if (specifier.type === "ImportSpecifier" && imported === "pipe")
                            pipeNames.add(local);
                    }
                    return;
                }
                if (node.source.value !== "effect/Effect")
                    return;
                for (const specifier of node.specifiers) {
                    const local = localNameOf(specifier);
                    if (local === undefined)
                        continue;
                    if (specifier.type === "ImportNamespaceSpecifier" ||
                        specifier.type === "ImportDefaultSpecifier") {
                        effectNamespaceNames.add(local);
                        continue;
                    }
                    const imported = importedNameOf(specifier);
                    if (imported === "flatMap")
                        flatMapNames.add(local);
                    else if (imported === "service")
                        serviceNames.add(local);
                }
            },
            CallExpression(node) {
                if (!inStaticClassField(context.sourceCode, node))
                    return;
                const args = node.arguments;
                if (isEffectCall(node, "flatMap", flatMapNames) && args.length >= 2) {
                    const first = args[0];
                    if (first !== undefined && isServiceAcquisition(first) && isForwardingFlatMap(node)) {
                        context.report({ node, messageId: "staticForwarder" });
                        return;
                    }
                }
                const callee = node.callee;
                let subject;
                let operators;
                if (callee.type === "Identifier") {
                    if (!pipeNames.has(callee.name))
                        return;
                    subject = args[0];
                    operators = args.slice(1);
                }
                else {
                    if (callee.type !== "MemberExpression" || memberName(callee) !== "pipe") {
                        return;
                    }
                    subject = callee.object;
                    operators = args;
                }
                if (subject !== undefined &&
                    isServiceAcquisition(subject) &&
                    operators.some((operator) => isForwardingFlatMap(operator))) {
                    context.report({ node, messageId: "staticForwarder" });
                }
            },
        };
    },
});
