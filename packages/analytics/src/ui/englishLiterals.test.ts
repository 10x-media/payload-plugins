import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

/** JSX props a reader sees or hears: anything else (a class, a role, a path) is no text. */
const SPOKEN_PROPS = new Set([
	'alt',
	'aria-description',
	'aria-label',
	'aria-roledescription',
	'aria-valuetext',
	'ariaLabel',
	'caption',
	'comparisonLabel',
	'emptyLabel',
	'header',
	'label',
	'labelHeader',
	'message',
	'pausedLabel',
	'periodLabel',
	'placeholder',
	'sampledLabel',
	'title',
	'valueLabel',
])

/** Field and option config Payload shows as written, in a `.ts` file as much as a `.tsx` one. */
const SHOWN_KEYS = new Set(['label', 'placeholder', 'description', 'caption', 'header'])

/**
 * Text that is data rather than wording: a code the vendor names its regions by, which reads
 * the same in every language.
 */
const ALLOWED: ReadonlyArray<{ file: string; text: string }> = [
	{ file: 'providers/collection.ts', text: 'US' },
	{ file: 'providers/collection.ts', text: 'EU' },
]

/** Directories with no admin wording: the browser tracker, the engines, adapters and test helpers. */
const SKIPPED = new Set(['adapters', 'native', 'testing', 'tracker'])

/** The admin's source: every component and the config builders, never a test. */
const sources = (dir: string): string[] =>
	readdirSync(dir).flatMap((name) => {
		const path = join(dir, name)
		if (statSync(path).isDirectory()) {
			return dir === SRC && SKIPPED.has(name) ? [] : sources(path)
		}
		return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
	})

const WORDS = /[A-Za-z]{2,}/

/** Text glued to a value (a template's or a concatenation's) is wording at one letter: `${n}s`. */
const LETTERS = /[A-Za-z]/

const textOf = (node: ts.Node): string | undefined =>
	ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined

interface Literal {
	at: string
	text: string
}

interface Fragment {
	node: ts.Node
	text: string
	/** Written beside a value rather than standing alone. */
	glued: boolean
}

const isTranslateCall = (node: ts.CallExpression): boolean => {
	const callee = node.expression
	return (
		(ts.isIdentifier(callee) && callee.text === 't') ||
		(ts.isPropertyAccessExpression(callee) && callee.name.text === 't')
	)
}

/** Every English word written straight into what one file shows the admin. */
const literalsIn = (name: string, source: string): Literal[] => {
	const found: Literal[] = []
	const kind = name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
	const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, kind)
	// A spoken prop fed by a constant (`aria-label={label}`) reads that constant's text.
	const constants = new Map<string, ts.Expression[]>()
	const collect = (node: ts.Node): void => {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
			constants.set(node.name.text, [...(constants.get(node.name.text) ?? []), node.initializer])
		}
		ts.forEachChild(node, collect)
	}
	collect(file)

	/** The text an expression puts in front of the reader, through the ways text is assembled. */
	const fragments = (expr: ts.Expression, seen: Set<string>, glued = false): Fragment[] => {
		const text = textOf(expr)
		if (text !== undefined) {
			return [{ node: expr, text, glued }]
		}
		if (ts.isTemplateExpression(expr)) {
			const literals = [expr.head, ...expr.templateSpans.map((span) => span.literal)]
			return [
				...literals.map((literal) => ({ node: expr, text: literal.text, glued: true })),
				...expr.templateSpans.flatMap((span) => fragments(span.expression, seen)),
			]
		}
		if (ts.isBinaryExpression(expr)) {
			const operator = expr.operatorToken.kind
			if (operator === ts.SyntaxKind.PlusToken) {
				return [...fragments(expr.left, seen, true), ...fragments(expr.right, seen, true)]
			}
			if (
				operator === ts.SyntaxKind.BarBarToken ||
				operator === ts.SyntaxKind.QuestionQuestionToken
			) {
				return [...fragments(expr.left, seen), ...fragments(expr.right, seen)]
			}
			return operator === ts.SyntaxKind.AmpersandAmpersandToken ? fragments(expr.right, seen) : []
		}
		if (ts.isConditionalExpression(expr)) {
			return [...fragments(expr.whenTrue, seen), ...fragments(expr.whenFalse, seen)]
		}
		if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr)) {
			return fragments(expr.expression, seen, glued)
		}
		if (ts.isCallExpression(expr) && isTranslateCall(expr)) {
			// The key is no text; the values filled into it are.
			return expr.arguments
				.slice(1)
				.flatMap((arg) =>
					ts.isObjectLiteralExpression(arg)
						? arg.properties.flatMap((property) =>
								ts.isPropertyAssignment(property) ? fragments(property.initializer, seen) : []
							)
						: []
				)
		}
		if (ts.isIdentifier(expr) && !seen.has(expr.text)) {
			const next = new Set(seen).add(expr.text)
			return (constants.get(expr.text) ?? []).flatMap((init) => fragments(init, next, glued))
		}
		return []
	}

	const report = (node: ts.Node, text: string, glued = false): void => {
		const trimmed = text.trim()
		if (
			!(glued ? LETTERS : WORDS).test(trimmed) ||
			ALLOWED.some((a) => a.file === name && a.text === trimmed)
		) {
			return
		}
		const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1
		found.push({ at: `${name}:${line}`, text: trimmed })
	}
	const reportAll = (expr: ts.Expression): void => {
		for (const fragment of fragments(expr, new Set())) {
			report(fragment.node, fragment.text, fragment.glued)
		}
	}
	const visit = (node: ts.Node): void => {
		if (ts.isJsxText(node)) {
			report(node, node.text)
		}
		if (ts.isJsxAttribute(node) && SPOKEN_PROPS.has(node.name.getText(file))) {
			const value = node.initializer
			const expr = value && ts.isJsxExpression(value) ? value.expression : value
			if (expr) reportAll(expr)
		}
		if (
			ts.isJsxExpression(node) &&
			node.expression &&
			(ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
		) {
			reportAll(node.expression)
		}
		if (
			ts.isPropertyAssignment(node) &&
			SHOWN_KEYS.has(node.name.getText(file).replace(/['"]/g, ''))
		) {
			reportAll(node.initializer)
		}
		ts.forEachChild(node, visit)
	}
	visit(file)
	return found
}

describe('admin wording', () => {
	it('finds wording glued into templates, concatenations and translation values', () => {
		const source = [
			`const a = <span>{\`\${t(keys.retry)} \${seconds}s\`}</span>`,
			`const label = \`\${direction} \${percent} \` + 'vs. before'`,
			'const b = <span aria-label={label} />',
			`const c = <p>{t(keys.retry, { duration: \`\${n} minutes\` })}</p>`,
			"const d = <p>{busy ? 'Loading' : null}</p>",
			`const e = <i className={\`analytics-chip--\${tone}\`} title={\`\${a}: \${b}\`} />`,
		].join('\n')
		expect(literalsIn('probe.tsx', source).map((literal) => literal.text)).toEqual([
			's',
			'vs. before',
			'minutes',
			'Loading',
		])
	})

	it('finds wording in text, in a spoken prop and in a shown field option', () => {
		const source = [
			"const a = <p aria-label='Close'>Last {'week'}</p>",
			"const b = { label: '5 min', value: '5' }",
			"const c = <i className='analytics-flag' aria-hidden='true' />",
		].join('\n')
		expect(literalsIn('probe.tsx', source).map((literal) => literal.text)).toEqual([
			'Close',
			'Last',
			'week',
			'5 min',
		])
	})

	it('writes no English straight into a component or a field: every word is a translation key', () => {
		const files = sources(SRC)
		expect(files.length).toBeGreaterThan(100)
		const found = files.flatMap((path) =>
			literalsIn(relative(SRC, path), readFileSync(path, 'utf8'))
		)
		expect(found).toEqual([])
	})
})
