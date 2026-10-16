/**
 * Whether a React hook used at `hookName` inside a function named `parentName`
 * violates the encapsulation rule. Provider components (XProvider) are the
 * stateful root of a context family and legitimately use hooks inline, so they
 * are exempt.
 *
 * @param {{ hookName: string; parentName: string }} input - The usage facts.
 * @returns {boolean} True when the usage should be reported.
 */
export declare function isEncapsulationViolation(input: {
    hookName: string;
    parentName: string;
}): boolean;
/**
 * Do not call React's hooks directly inside a component. Abstract the
 * functionality into a custom hook (`useXxx`) and call that instead - the
 * "useEncapsulation" pattern. A component that reaches for `useState`/`useEffect`
 * inline hides its state and effects; a custom hook names them and can be tested
 * and composed in isolation. Provider components (XProvider) are exempt: they are
 * the stateful root of a context family and must use hooks inline.
 */
export declare const useEncapsulationRule: import("@oxlint/plugins").Rule;
