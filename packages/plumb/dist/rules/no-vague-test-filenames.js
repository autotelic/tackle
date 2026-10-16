import { defineRule } from "@oxlint/plugins";
const TEST_FILE = /.(?:test|spec).[cm]?[jt]sx?$/u;
/** Stems that name nothing; a test file must point back at the module it covers. */
const VAGUE_STEMS = new Set([
    "index",
    "test",
    "tests",
    "spec",
    "util",
    "utils",
    "helper",
    "helpers",
    "misc",
    "common",
    "shared",
    "core",
    "base",
    "main",
    "lib",
]);
/** Strip the directory and extension from a test filename.
 *
 * @param {string} filename - The raw filename to process.
 * @returns {string} The bare stem without path or extension. */
function testFileStem(filename) {
    const segments = filename.replaceAll("\\", "/").split("/");
    const base = segments[segments.length - 1] ?? "";
    return base.replace(/\.[cm]?[jt]sx?$/u, "").replace(/\.(?:test|spec)$/u, "");
}
/** Name test files after the source they cover so agents can navigate both directions. */
export const noVagueTestFilenamesRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Disallow vague test file names (index.test.ts, utils.test.ts, ...) because tests are found by searching for the source module's name; a test file that does not name the code it covers costs extra agent turns to locate.",
        },
        messages: {
            vagueTestFilename: "Test file `{{stem}}.test.ts` does not name the source it covers. Rename it after the module under test (e.g. `stripe.ts` -> `stripe.test.ts`) so searches for the source name land on its tests too.",
        },
    },
    createOnce(context) {
        let filePath = "";
        return {
            before() {
                filePath = context.filename.replaceAll("\\", "/");
            },
            Program(node) {
                if (!TEST_FILE.test(filePath))
                    return;
                const stem = testFileStem(filePath);
                if (!VAGUE_STEMS.has(stem.toLowerCase()))
                    return;
                context.report({
                    node,
                    messageId: "vagueTestFilename",
                    data: { stem },
                });
            },
        };
    },
});
