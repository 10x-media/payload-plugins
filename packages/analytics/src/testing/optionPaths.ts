import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const OPTIONS_FILE = fileURLToPath(new URL('../core/options.ts', import.meta.url))
const SRC = fileURLToPath(new URL('..', import.meta.url))

/** Types handed over whole (a host's store, an SDK module): their members are not options. */
const WHOLE_TYPES = new Set(['CacheStore', 'Ga4Sdk', 'MaxmindSdk'])

/** Maps keyed by a name the host picks, documented once under a placeholder. */
export const KEYED: Readonly<Record<string, string>> = {
	collections: '<slug>',
	'widgets.overrides': '<slug>',
}

/** One option path, and what its type lets a host write there. */
export interface OptionPath {
	path: string
	/** The value types a probe is checked against, by the type checker. */
	accepts: (probe: string | number | boolean) => boolean
	/** The path holds one of the plugin's own option objects, whose keys are all known. */
	closed: boolean
}

const declaredInSrc = (type: ts.Type): boolean => {
	const symbol = type.aliasSymbol ?? type.getSymbol()
	const declarations = symbol?.getDeclarations() ?? []
	return (
		declarations.length > 0 &&
		declarations.every((declaration) => declaration.getSourceFile().fileName.startsWith(SRC))
	)
}

/** An options object to walk into: the plugin's own object type, not a function, list or map. */
const isOptionsObject = (checker: ts.TypeChecker, type: ts.Type): boolean => {
	const name = (type.aliasSymbol ?? type.getSymbol())?.getName() ?? ''
	return (
		(type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) !== 0 &&
		!checker.isArrayType(type) &&
		!checker.isTupleType(type) &&
		type.getCallSignatures().length === 0 &&
		type.getConstructSignatures().length === 0 &&
		checker.getIndexInfosOfType(type).length === 0 &&
		!WHOLE_TYPES.has(name) &&
		declaredInSrc(type)
	)
}

const membersOf = (type: ts.Type): ts.Type[] => (type.isUnion() ? type.types : [type])

/** Value type of a host-keyed map: its index signature's, or its first key's. */
const keyedValue = (checker: ts.TypeChecker, type: ts.Type, at: ts.Node): ts.Type | undefined => {
	const index = checker.getIndexInfosOfType(type)[0]
	if (index) {
		return checker.getNonNullableType(index.type)
	}
	const first = checker.getPropertiesOfType(type)[0]
	return first
		? checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(first, at))
		: undefined
}

let walked: OptionPath[] | undefined

/**
 * Every dotted option path of `AnalyticsPluginOptions`, read off the type itself, with a host-keyed
 * map's key written once as its placeholder.
 */
export const optionPaths = (): OptionPath[] => {
	if (walked) {
		return walked
	}
	const program = ts.createProgram([OPTIONS_FILE], {
		strict: true,
		noEmit: true,
		skipLibCheck: true,
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		jsx: ts.JsxEmit.ReactJSX,
		customConditions: ['development'],
	})
	const checker = program.getTypeChecker()
	const source = program.getSourceFile(OPTIONS_FILE)
	const declaration = source?.statements.find(
		(statement): statement is ts.TypeAliasDeclaration =>
			ts.isTypeAliasDeclaration(statement) && statement.name.text === 'AnalyticsPluginOptions'
	)
	if (!declaration) {
		throw new Error('AnalyticsPluginOptions is not declared in options.ts')
	}
	const probeType = (probe: string | number | boolean): ts.Type =>
		typeof probe === 'string'
			? checker.getStringLiteralType(probe)
			: typeof probe === 'number'
				? checker.getNumberLiteralType(probe)
				: probe
					? checker.getTrueType()
					: checker.getFalseType()
	const found = new Map<string, OptionPath>()
	const walk = (type: ts.Type, prefix: string, seen: ReadonlySet<ts.Type>): void => {
		if (seen.has(type)) {
			return
		}
		const next = new Set(seen).add(type)
		for (const property of checker.getPropertiesOfType(type)) {
			const path = prefix ? `${prefix}.${property.getName()}` : property.getName()
			const value = checker.getNonNullableType(
				checker.getTypeOfSymbolAtLocation(property, declaration)
			)
			found.set(path, {
				path,
				accepts: (probe) => checker.isTypeAssignableTo(probeType(probe), value),
				closed: membersOf(value).some((member) => isOptionsObject(checker, member)),
			})
			const placeholder = KEYED[path]
			if (placeholder) {
				const keyed = keyedValue(checker, value, declaration)
				if (keyed && isOptionsObject(checker, keyed)) {
					walk(keyed, `${path}.${placeholder}`, next)
				}
				continue
			}
			for (const member of membersOf(value)) {
				if (isOptionsObject(checker, member)) {
					walk(member, path, next)
				}
			}
		}
	}
	walk(checker.getTypeAtLocation(declaration.name), '', new Set())
	walked = [...found.values()].sort((a, b) => a.path.localeCompare(b.path))
	return walked
}
