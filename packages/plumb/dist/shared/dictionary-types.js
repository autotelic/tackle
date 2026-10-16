const BUILT_INS = new Set([
    "Record",
    "Readonly",
    "Partial",
    "Required",
    "Pick",
    "Omit",
    "PropertyKey",
    "NonNullable",
]);
const TRANSPARENT_WRAPPERS = new Set(["Readonly", "Partial", "Required", "NonNullable"]);
/**
 * Build the alias/interface maps for a program so type references can be
 * resolved to their declarations during dictionary classification.
 * @param {ESTree.Program} program - Root AST node of the file under lint.
 * @returns {TypeEnvironment} Environment mapping declared names to their declaration nodes.
 */
export function createTypeEnvironment(program) {
    const aliases = new Map();
    const interfaces = new Map();
    const shadowedBuiltIns = new Set();
    for (const statement of program.body) {
        const declaration = statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration"
            ? statement.declaration ?? null
            : statement;
        if (declaration?.type === "ImportDeclaration") {
            for (const specifier of declaration.specifiers) {
                if (BUILT_INS.has(specifier.local.name))
                    shadowedBuiltIns.add(specifier.local.name);
            }
            continue;
        }
        if (declaration?.type === "TSTypeAliasDeclaration") {
            const existing = aliases.get(declaration.id.name);
            if (existing === undefined)
                aliases.set(declaration.id.name, declaration);
            else
                shadowedBuiltIns.add(declaration.id.name);
            if (BUILT_INS.has(declaration.id.name))
                shadowedBuiltIns.add(declaration.id.name);
            continue;
        }
        if (declaration?.type === "TSInterfaceDeclaration") {
            const declarations = interfaces.get(declaration.id.name) ?? [];
            declarations.push(declaration);
            interfaces.set(declaration.id.name, declarations);
            if (BUILT_INS.has(declaration.id.name))
                shadowedBuiltIns.add(declaration.id.name);
            continue;
        }
        if (declaration?.type === "TSEnumDeclaration") {
            if (BUILT_INS.has(declaration.id.name))
                shadowedBuiltIns.add(declaration.id.name);
            continue;
        }
        if ((declaration?.type === "ClassDeclaration" ||
            declaration?.type === "FunctionDeclaration") &&
            declaration.id !== null) {
            if (BUILT_INS.has(declaration.id.name))
                shadowedBuiltIns.add(declaration.id.name);
        }
    }
    return { aliases, interfaces, shadowedBuiltIns };
}
function typeReferenceName(type) {
    return type.typeName.type === "Identifier" ? type.typeName.name : null;
}
function isBuiltIn(payload) {
    return BUILT_INS.has(payload.name) && !payload.environment.shadowedBuiltIns.has(payload.name);
}
function isUnappliedReferenceTo(payload) {
    const unwrapped = unwrapTransparentType(payload.type);
    return (unwrapped.type === "TSTypeReference" &&
        typeReferenceName(unwrapped) === payload.name &&
        (unwrapped.typeArguments === null ||
            unwrapped.typeArguments === undefined ||
            unwrapped.typeArguments.params.length === 0));
}
function unwrapTransparentType(type) {
    let current = type;
    while (current.type === "TSParenthesizedType" ||
        (current.type === "TSTypeOperator" && current.operator === "readonly")) {
        current = current.typeAnnotation;
    }
    return current;
}
function isEffectivelyEmptyMember(member) {
    return (member.type === "TSPropertySignature" &&
        member.optional === true &&
        member.typeAnnotation !== null &&
        member.typeAnnotation !== undefined &&
        unwrapTransparentType(member.typeAnnotation.typeAnnotation).type === "TSNeverKeyword");
}
function resolvedSubstitutionArgument(payload) {
    const { type, base } = payload;
    const resolving = payload.resolving ?? new Set();
    const unwrapped = unwrapTransparentType(type);
    if (unwrapped.type !== "TSTypeReference")
        return type;
    const name = typeReferenceName(unwrapped);
    if (name === null || resolving.has(name))
        return type;
    const substitution = base.get(name);
    if (substitution === undefined)
        return type;
    const nextResolving = new Set(resolving);
    nextResolving.add(name);
    return resolvedSubstitutionArgument({ type: substitution, base, resolving: nextResolving });
}
function aliasSubstitution(alias, type, base) {
    const parameters = alias.typeParameters?.params ?? [];
    const arguments_ = type.typeArguments?.params ?? [];
    const next = new Map(base);
    for (const [index, parameter] of parameters.entries()) {
        const argument = arguments_[index] ?? parameter.default;
        if (argument === null || argument === undefined)
            return null;
        next.set(parameter.name.name, resolvedSubstitutionArgument({ type: argument, base }));
    }
    return next;
}
function unsafeDirectValue(type, environment, substitutions, resolvingAliases) {
    const unwrapped = unwrapTransparentType(type);
    if (unwrapped.type === "TSUnknownKeyword")
        return "unknown";
    if (unwrapped.type === "TSAnyKeyword")
        return "any";
    if (unwrapped.type === "TSObjectKeyword")
        return "object";
    if (unwrapped.type === "TSTypeLiteral" &&
        (unwrapped.members.length === 0 || unwrapped.members.every(isEffectivelyEmptyMember)))
        return "empty-object";
    if (unwrapped.type === "TSUnionType") {
        return unwrapped.types.some((member) => unsafeDirectValue(member, environment, substitutions, resolvingAliases) !== null)
            ? "union"
            : null;
    }
    if (unwrapped.type === "TSIntersectionType") {
        const unsafeMembers = unwrapped.types.map((member) => unsafeDirectValue(member, environment, substitutions, resolvingAliases));
        if (unsafeMembers.includes("any"))
            return "any";
        const [firstUnsafeMember] = unsafeMembers;
        return unsafeMembers.length > 0 &&
            firstUnsafeMember !== undefined &&
            unsafeMembers.every((member) => member !== null)
            ? firstUnsafeMember
            : null;
    }
    if (unwrapped.type !== "TSTypeReference")
        return null;
    const name = typeReferenceName(unwrapped);
    if (name === null)
        return null;
    if (TRANSPARENT_WRAPPERS.has(name) && isBuiltIn({ name, environment })) {
        const wrapped = unwrapped.typeArguments?.params[0];
        return wrapped === undefined
            ? null
            : unsafeDirectValue(wrapped, environment, substitutions, resolvingAliases);
    }
    const substitution = substitutions.get(name);
    if (substitution !== undefined) {
        return isUnappliedReferenceTo({ type: substitution, name })
            ? null
            : unsafeDirectValue(substitution, environment, substitutions, resolvingAliases);
    }
    const interfaceDeclarations = environment.interfaces.get(name);
    if (interfaceDeclarations !== undefined) {
        const [declaration] = interfaceDeclarations;
        const effectivelyEmpty = interfaceDeclarations.length === 1 &&
            declaration !== undefined &&
            declaration.extends.length === 0 &&
            (declaration.body.body.length === 0 ||
                declaration.body.body.every(isEffectivelyEmptyMember));
        return effectivelyEmpty ? "empty-object" : null;
    }
    const alias = environment.aliases.get(name);
    if (alias === undefined || resolvingAliases.has(name))
        return null;
    const nextSubstitutions = aliasSubstitution(alias, unwrapped, substitutions);
    if (nextSubstitutions === null)
        return null;
    const nextResolving = new Set(resolvingAliases);
    nextResolving.add(name);
    return unsafeDirectValue(alias.typeAnnotation, environment, nextSubstitutions, nextResolving);
}
function dictionaryValueTypes(type, environment, substitutions, resolvingAliases) {
    const unwrapped = unwrapTransparentType(type);
    if (unwrapped.type === "TSTypeLiteral") {
        return unwrapped.members.flatMap((member) => member.type === "TSIndexSignature" && member.typeAnnotation !== null
            ? [{ type: member.typeAnnotation.typeAnnotation, substitutions }]
            : []);
    }
    if (unwrapped.type === "TSMappedType") {
        return unwrapped.typeAnnotation === null
            ? []
            : [{ type: unwrapped.typeAnnotation, substitutions }];
    }
    if (unwrapped.type !== "TSTypeReference")
        return [];
    const name = typeReferenceName(unwrapped);
    if (name === null)
        return [];
    const substitution = substitutions.get(name);
    if (substitution !== undefined) {
        return isUnappliedReferenceTo({ type: substitution, name })
            ? []
            : dictionaryValueTypes(substitution, environment, substitutions, resolvingAliases);
    }
    if (TRANSPARENT_WRAPPERS.has(name) && isBuiltIn({ name, environment })) {
        const wrapped = unwrapped.typeArguments?.params[0];
        return wrapped === undefined
            ? []
            : dictionaryValueTypes(wrapped, environment, substitutions, resolvingAliases);
    }
    if (name === "Record" && isBuiltIn({ name, environment })) {
        const value = unwrapped.typeArguments?.params[1] ?? null;
        return value === null ? [] : [{ type: value, substitutions }];
    }
    if ((name === "Pick" || name === "Omit") && isBuiltIn({ name, environment })) {
        const source = unwrapped.typeArguments?.params[0];
        return source === undefined
            ? []
            : dictionaryValueTypes(source, environment, substitutions, resolvingAliases);
    }
    const alias = environment.aliases.get(name);
    if (alias === undefined || resolvingAliases.has(name))
        return [];
    const nextSubstitutions = aliasSubstitution(alias, unwrapped, substitutions);
    if (nextSubstitutions === null)
        return [];
    const nextResolving = new Set(resolvingAliases);
    nextResolving.add(name);
    return dictionaryValueTypes(alias.typeAnnotation, environment, nextSubstitutions, nextResolving);
}
/**
 * Classify a single type as an unsafe dictionary value, if it is one.
 * @param {ESTree.TSType} valueType - Type annotation of the dictionary value slot.
 * @param {TypeEnvironment} environment - Declared-alias environment from createTypeEnvironment.
 * @returns {UnsafeDictionary | null} The unsafe kind ("any", "unknown", "object", "empty-object") or null.
 */
export function classifyUnsafeDictionaryValue(valueType, environment) {
    const unsafeValue = unsafeDirectValue(valueType, environment, new Map(), new Set());
    return unsafeValue === null ? null : { kind: "unsafe-dictionary", unsafeValue };
}
/**
 * Classify the value side of an index-signature or Record dictionary.
 * @param {ESTree.TSType} type - The dictionary type node being inspected.
 * @param {TypeEnvironment} environment - Declared-alias environment from createTypeEnvironment.
 * @returns {UnsafeDictionary | null} Classification with kind and location, or null when safe.
 */
export function classifyUnsafeDictionary(type, environment) {
    for (const valueType of dictionaryValueTypes(type, environment, new Map(), new Set())) {
        const unsafeValue = unsafeDirectValue(valueType.type, environment, valueType.substitutions, new Set());
        if (unsafeValue !== null)
            return { kind: "unsafe-dictionary", unsafeValue };
    }
    return null;
}
/**
 * Describe what a widening assignment erases, for report messaging.
 * @param {ESTree.TSType} type - The assigned (widened) type.
 * @param {TypeEnvironment} environment - Declared-alias environment from createTypeEnvironment.
 * @returns {WideningTarget | null} Human-readable target description, or null when not a widening.
 */
export function classifyWideningTarget(type, environment) {
    const unwrapped = unwrapTransparentType(type);
    if (unwrapped.type === "TSUnknownKeyword")
        return { kind: "unknown" };
    if (unwrapped.type === "TSObjectKeyword")
        return { kind: "object" };
    if (unwrapped.type === "TSTypeLiteral") {
        return unwrapped.members.some((member) => member.type === "TSIndexSignature")
            ? { kind: "open dictionary" }
            : unwrapped.members.length > 0
                ? { kind: "anonymous object" }
                : null;
    }
    if (unwrapped.type === "TSMappedType")
        return { kind: "open dictionary" };
    if (unwrapped.type !== "TSTypeReference")
        return null;
    const name = typeReferenceName(unwrapped);
    if (name === null)
        return null;
    if (TRANSPARENT_WRAPPERS.has(name) && isBuiltIn({ name, environment })) {
        const wrapped = unwrapped.typeArguments?.params[0];
        return wrapped === undefined ? null : classifyWideningTarget(wrapped, environment);
    }
    if (name === "Record" && isBuiltIn({ name, environment }))
        return { kind: "open dictionary" };
    const alias = environment.aliases.get(name);
    if (alias === undefined)
        return null;
    if ((alias.typeParameters?.params.length ?? 0) > 0) {
        const substitutions = aliasSubstitution(alias, unwrapped, new Map());
        const resolves = substitutions !== null &&
            dictionaryValueTypes(alias.typeAnnotation, environment, substitutions, new Set([name])).length > 0;
        return resolves ? { kind: "generic container" } : null;
    }
    const substitutions = aliasSubstitution(alias, unwrapped, new Map());
    if (substitutions === null)
        return null;
    const resolved = classifyAliasBroadTarget(alias.typeAnnotation, environment, substitutions, new Set([name]));
    return resolved;
}
function isBroadMappedKey(type, environment, substitutions) {
    const unwrapped = unwrapTransparentType(type);
    if (unwrapped.type === "TSStringKeyword" ||
        unwrapped.type === "TSNumberKeyword" ||
        unwrapped.type === "TSSymbolKeyword") {
        return true;
    }
    if (unwrapped.type === "TSUnionType") {
        return unwrapped.types.every((member) => isBroadMappedKey(member, environment, substitutions));
    }
    if (unwrapped.type !== "TSTypeReference")
        return false;
    const name = typeReferenceName(unwrapped);
    if (name === null)
        return false;
    const substitution = substitutions.get(name);
    if (substitution !== undefined && !isUnappliedReferenceTo({ type: substitution, name })) {
        return isBroadMappedKey(substitution, environment, substitutions);
    }
    return name === "PropertyKey" && isBuiltIn({ name, environment });
}
function classifyAliasBroadTarget(type, environment, substitutions, resolvingAliases) {
    const unwrapped = unwrapTransparentType(type);
    if (unwrapped.type === "TSUnknownKeyword")
        return { kind: "unknown" };
    if (unwrapped.type === "TSObjectKeyword")
        return { kind: "object" };
    if (unwrapped.type === "TSTypeLiteral") {
        return unwrapped.members.some((member) => member.type === "TSIndexSignature")
            ? { kind: "open dictionary" }
            : null;
    }
    if (unwrapped.type === "TSMappedType") {
        return isBroadMappedKey(unwrapped.constraint, environment, substitutions)
            ? { kind: "open dictionary" }
            : null;
    }
    if (unwrapped.type !== "TSTypeReference")
        return null;
    const name = typeReferenceName(unwrapped);
    if (name === null)
        return null;
    const substitution = substitutions.get(name);
    if (substitution !== undefined) {
        return isUnappliedReferenceTo({ type: substitution, name })
            ? null
            : classifyAliasBroadTarget(substitution, environment, substitutions, resolvingAliases);
    }
    if (TRANSPARENT_WRAPPERS.has(name) && isBuiltIn({ name, environment })) {
        const wrapped = unwrapped.typeArguments?.params[0];
        return wrapped === undefined
            ? null
            : classifyAliasBroadTarget(wrapped, environment, substitutions, resolvingAliases);
    }
    if (name === "Record" && isBuiltIn({ name, environment })) {
        return { kind: "open dictionary" };
    }
    const alias = environment.aliases.get(name);
    if (alias === undefined || resolvingAliases.has(name))
        return null;
    const nextSubstitutions = aliasSubstitution(alias, unwrapped, substitutions);
    if (nextSubstitutions === null)
        return null;
    const nextResolving = new Set(resolvingAliases);
    nextResolving.add(name);
    return classifyAliasBroadTarget(alias.typeAnnotation, environment, nextSubstitutions, nextResolving);
}
/**
 * Whether an expression is an object literal carrying at least one property.
 * @param {ESTree.Expression} expression - Candidate expression node.
 * @returns {boolean} True only for ObjectExpression nodes with members.
 */
export function isPopulatedObjectExpression(expression) {
    let current = expression;
    while (current.type === "ParenthesizedExpression" ||
        current.type === "TSAsExpression" ||
        current.type === "TSTypeAssertion" ||
        current.type === "TSNonNullExpression") {
        current = current.expression;
    }
    return current.type === "ObjectExpression" && current.properties.length > 0;
}
/**
 * Whether an expression carries first-hand type evidence (schema parse,
 * literal, typed constructor) and therefore needs no further guarding.
 * @param {ESTree.Expression} expression - Candidate expression node.
 * @returns {boolean} True when the expression is self-evidencing.
 */
export function isKnownEvidenceExpression(expression) {
    let current = expression;
    while (current.type === "ParenthesizedExpression" ||
        current.type === "TSAsExpression" ||
        current.type === "TSTypeAssertion" ||
        current.type === "TSNonNullExpression" ||
        current.type === "TSSatisfiesExpression") {
        current = current.expression;
    }
    if (current.type === "ObjectExpression")
        return true;
    return (current.type === "ArrayExpression" ||
        current.type === "ArrowFunctionExpression" ||
        current.type === "ClassExpression" ||
        current.type === "FunctionExpression" ||
        current.type === "NewExpression" ||
        current.type === "Literal" ||
        current.type === "TemplateLiteral" ||
        current.type === "UnaryExpression");
}
