import { defineRule } from "@oxlint/plugins";
import { ancestorsOf } from "../../shared/ancestors.js";
import { isString } from "../../shared/structural.js";
const TEST_FILE = /.(?:test|spec).[cm]?[jt]sx?$|\/test\//u;
const BANNED_STORAGE = new Set(["indexedDB", "localStorage", "sessionStorage"]);
/**
 * The banned-storage global named by an identifier, if any.
 *
 * @param {ESTree.Node} node - The identifier node to test.
 * @returns {string | null} The banned storage name, or null.
 */
function storageName(node) {
    if (node.type !== "Identifier")
        return null;
    return BANNED_STORAGE.has(node.name) ? node.name : null;
}
/** Browser storage globals hide I/O from the Effect runtime; persist through KeyValueStore or an injected store. */
export const noDirectBrowserStorageRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Disallow direct browser storage globals (indexedDB, localStorage, sessionStorage); persist through Effect's KeyValueStore/IndexedDb modules or an injected storage service.",
        },
        messages: {
            directStorage: "`{{name}}` is reached directly, hiding I/O from the Effect runtime. Persist through Effect's KeyValueStore/IndexedDb layer or an injected storage service so access stays testable and swappable.",
        },
    },
    createOnce(context) {
        const reportStorage = (node, name) => {
            context.report({ node, messageId: "directStorage", data: { name } });
        };
        return {
            before() {
                if (TEST_FILE.test(context.filename.replaceAll("\\", "/")))
                    return false;
            },
            Identifier(node) {
                const name = storageName(node);
                if (name === null)
                    return;
                const chain = ancestorsOf(context.sourceCode, node);
                const parent = chain[0];
                const grandparent = chain[1];
                if (parent === undefined)
                    return;
                if (parent.type === "MemberExpression") {
                    return;
                }
                if (parent.type === "Property") {
                    const containerType = grandparent === undefined ? "" : grandparent.type;
                    if (parent.key === node && parent.value !== node && containerType !== "ObjectPattern") {
                        return;
                    }
                }
                if (parent.type === "ImportSpecifier") {
                    if (parent.imported === node && parent.local !== node) {
                        return;
                    }
                }
                reportStorage(node, name);
            },
            MemberExpression(node) {
                const direct = storageName(node.object);
                if (direct !== null) {
                    reportStorage(node, direct);
                    return;
                }
                if (node.object.type !== "Identifier")
                    return;
                const objectName = node.object.name;
                if (objectName !== "globalThis" && objectName !== "window")
                    return;
                let propertyName;
                if (node.computed) {
                    if (node.property.type === "Literal" && isString(node.property.value)) {
                        propertyName = node.property.value;
                    }
                }
                else if (node.property.type === "Identifier") {
                    propertyName = node.property.name;
                }
                if (propertyName !== undefined && BANNED_STORAGE.has(propertyName)) {
                    reportStorage(node, propertyName);
                }
            },
        };
    },
});
