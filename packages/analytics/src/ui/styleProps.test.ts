import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The custom properties `cssVars.ts` adds to React's `CSSProperties`: geometry only a render knows. */
const declaredCustomProperties = (): Set<string> => {
	const path = join(SRC, 'ui', 'cssVars.ts')
	const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
	const names = new Set<string>()
	const visit = (node: ts.Node): void => {
		if (ts.isInterfaceDeclaration(node) && node.name.text === 'CSSProperties') {
			for (const member of node.members) {
				if (ts.isPropertySignature(member) && ts.isStringLiteral(member.name)) {
					names.add(member.name.text)
				}
			}
		}
		ts.forEachChild(node, visit)
	}
	visit(file)
	return names
}

const ALLOWED = declaredCustomProperties()

const components = (dir: string): string[] =>
	readdirSync(dir).flatMap((name) => {
		const path = join(dir, name)
		if (statSync(path).isDirectory()) {
			return components(path)
		}
		return path.endsWith('.tsx') && !path.includes('.test.') ? [path] : []
	})

/** True when `name` is declared in `file` from Payload's `mergeFieldStyles`, a field's own admin style. */
const fieldStyleBinding = (name: string, file: ts.SourceFile): boolean => {
	let bound = false
	const visit = (node: ts.Node): void => {
		if (
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			node.name.text === name &&
			node.initializer !== undefined &&
			/\bmergeFieldStyles\(/.test(node.initializer.getText(file))
		) {
			bound = true
		}
		ts.forEachChild(node, visit)
	}
	visit(file)
	return bound
}

interface StyleProp {
	at: string
	kind: 'custom-properties' | 'field-style'
	offence: string | null
}

/** Every `style` prop and `<style>` element under `src`, and what, if anything, breaks the rule. */
const scan = (): StyleProp[] => {
	const found: StyleProp[] = []
	for (const path of components(SRC)) {
		const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
		const where = (node: ts.Node): string =>
			`${relative(SRC, path)}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`
		const visit = (node: ts.Node): void => {
			if (
				(ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
				node.tagName.getText(file) === 'style'
			) {
				found.push({ at: where(node), kind: 'custom-properties', offence: '<style> element' })
			}
			if (ts.isJsxAttribute(node) && node.name.getText(file) === 'style') {
				const expression =
					node.initializer && ts.isJsxExpression(node.initializer)
						? node.initializer.expression
						: undefined
				if (expression && ts.isObjectLiteralExpression(expression)) {
					const bad = expression.properties.find(
						(property) =>
							!ts.isPropertyAssignment(property) ||
							!ts.isStringLiteral(property.name) ||
							!ALLOWED.has(property.name.text)
					)
					found.push({
						at: where(node),
						kind: 'custom-properties',
						offence: bad ? bad.getText(file) : null,
					})
				} else if (
					expression &&
					ts.isIdentifier(expression) &&
					fieldStyleBinding(expression.text, file)
				) {
					found.push({ at: where(node), kind: 'field-style', offence: null })
				} else {
					found.push({ at: where(node), kind: 'custom-properties', offence: node.getText(file) })
				}
			}
			ts.forEachChild(node, visit)
		}
		visit(file)
	}
	return found
}

describe('inline styles', () => {
	const props = scan()

	it('are only the custom properties the stylesheet reads, or a field admin style', () => {
		expect(props.filter((prop) => prop.offence !== null)).toEqual([])
	})

	// Guards the scan itself: an empty result would pass the rule above vacuously.
	it('are found where the bars, the chart and the custom fields set them', () => {
		expect(ALLOWED.has('--analytics-bar')).toBe(true)
		const at = (file: string, kind: StyleProp['kind']) =>
			props.filter((prop) => prop.kind === kind && prop.at.startsWith(file)).length
		// A row's bar share and the pointer tooltip's anchor.
		expect(at('ui/components/DataTable.tsx:', 'custom-properties')).toBe(2)
		// The height, then each dot, the cursor, the active points, the readout and a tick by share.
		expect(at('charts/TrendChart.tsx:', 'custom-properties')).toBe(7)
		expect(at('goals/GoalSelectField.tsx:', 'field-style')).toBe(1)
		expect(at('fields/dateRange/ui.tsx:', 'field-style')).toBe(1)
		// Each config field honours its own admin width and style, the selects through shared ones.
		expect(at('fields/config/OptionSelect.tsx:', 'field-style')).toBe(1)
		expect(at('fields/config/FilterKeySelect.tsx:', 'field-style')).toBe(1)
		expect(at('fields/config/FilterValueField.tsx:', 'field-style')).toBe(1)
	})
})
