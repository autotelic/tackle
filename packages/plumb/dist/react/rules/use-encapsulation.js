import { defineRule } from "@oxlint/plugins";
import { ancestorsOf } from "../../shared/ancestors.js";
import { readField } from "../../shared/structural.js";
import { isProviderName } from "../role.js";
const TEST_FILE = /.(?:test|spec).[cm]?[jt]sx?$/u;
/** Pattern identifying custom hooks (names starting with `use`). */
const HOOK_PATTERN = /^use/u;
/** React's built-in hooks that must not be used directly inside components. */
const REACT_HOOKS = new Set([
    "useCallback",
    "useContext",
    "useDebugValue",
    "useDeferredValue",
    "useEffect",
    "useId",
    "useImperativeHandle",
    "useInsertionEffect",
    "useLayoutEffect",
    "useMemo",
    "useReducer",
    "useRef",
    "useState",
    "useSyncExternalStore",
    "useTransition",
]);
/**
 * Whether a React hook used at `hookName` inside a function named `parentName`
 * violates the encapsulation rule. Provider components (XProvider) are the
 * stateful root of a context family and legitimately use hooks inline, so they
 * are exempt.
 *
 * @param {{ hookName: string; parentName: string }} input - The usage facts.
 * @returns {boolean} True when the usage should be reported.
 */
export function isEncapsulationViolation(input) {
    return REACT_HOOKS.has(input.hookName) && !HOOK_PATTERN.test(input.parentName) && !isProviderName(input.parentName);
}
/**
 * Do not call React's hooks directly inside a component. Abstract the
 * functionality into a custom hook (`useXxx`) and call that instead - the
 * "useEncapsulation" pattern. A component that reaches for `useState`/`useEffect`
 * inline hides its state and effects; a custom hook names them and can be tested
 * and composed in isolation. Provider components (XProvider) are exempt: they are
 * the stateful root of a context family and must use hooks inline.
 */
export const useEncapsulationRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Disallow using React's hooks directly inside a component; abstract them into a custom hook (useXxx) and call that instead (useEncapsulation).",
        },
        messages: {
            noDirectHooks: "Do not use React hook `{{hook}}` directly inside component `{{parent}}`. Abstract the functionality into a custom hook (useXxx) and call that instead.",
        },
    },
    createOnce(context) {
        const raw = readField(context, "options");
        const options = raw?.[0] ?? {};
        const allowed = new Set(options.allow ?? []);
        const blocked = new Set(options.block ?? []);
        const hooksToCheck = new Set([...REACT_HOOKS, ...blocked].filter((h) => !allowed.has(h)));
        function nearestFunctionName(node) {
            const ancestors = ancestorsOf(context.sourceCode, node);
            for (let i = ancestors.length - 1; i >= 0; i--) {
                const a = ancestors[i];
                if (a === undefined)
                    continue;
                if (a.type === "FunctionDeclaration" && a.id !== null && a.id !== undefined)
                    return a.id.name;
                if (a.type === "FunctionExpression" && a.id !== null && a.id !== undefined)
                    return a.id.name;
                if (a.type === "VariableDeclarator" && a.id.type === "Identifier") {
                    const init = a.init;
                    if (init !== null &&
                        init !== undefined &&
                        (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression"))
                        return a.id.name;
                }
            }
            return null;
        }
        return {
            before() {
                if (TEST_FILE.test(context.filename.replaceAll("\\", "/")))
                    return false;
            },
            Identifier(node) {
                if (!hooksToCheck.has(node.name))
                    return;
                const parent = nearestFunctionName(node);
                if (parent !== null && !HOOK_PATTERN.test(parent) && !isProviderName(parent)) {
                    context.report({ node, messageId: "noDirectHooks", data: { hook: node.name, parent } });
                }
            },
        };
    },
});
