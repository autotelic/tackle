import { defineRule } from "@oxlint/plugins";
const TEST_FILE = /.(?:test|spec).[cm]?[jt]sx?$/u;
/**
 * decodeUnknownOption collapses every schema mismatch into None, discarding
 * the issue tree that explains why decoding failed. Prefer adapters that keep
 * the issues: SchemaParser.decodeUnknownResult for sync cores,
 * decodeUnknownEffect on the Effect channel.
 */
export const noDecodeUnknownOptionRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Disallow Schema.decodeUnknownOption outside tests: it discards mismatch details. Return the schema issues as typed failure evidence instead.",
        },
        messages: {
            noDecodeUnknownOption: "`decodeUnknownOption` intentionally discards mismatch details, so callers cannot learn why decoding failed. Use `SchemaParser.decodeUnknownResult(schema)` (sync cores) or `SchemaParser.decodeUnknownEffect(schema)` (Effect channel) and fold the issue into your tagged error's evidence.",
        },
    },
    createOnce(context) {
        return {
            before() {
                if (TEST_FILE.test(context.filename.replaceAll("\\", "/")))
                    return false;
            },
            MemberExpression(node) {
                if (!node.computed &&
                    node.property.type === "Identifier" &&
                    node.property.name === "decodeUnknownOption") {
                    context.report({ node, messageId: "noDecodeUnknownOption" });
                }
            },
        };
    },
});
