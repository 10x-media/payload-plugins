import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const STYLESHEET = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'analytics.css'),
	'utf8'
)

/** The shipped stylesheet's text, for tests that assert what it declares. */
export const analyticsCss = (): string => STYLESHEET

/**
 * Declarations of the rule whose selector is exactly `selector` (empty when none): jsdom applies no
 * stylesheet, so a test of the look reads the rule a class maps to.
 */
export const declarationsOf = (selector: string): Record<string, string> => {
	const opening = `\n\t${selector} {\n`
	const start = STYLESHEET.indexOf(opening)
	if (start === -1) {
		return {}
	}
	const body = STYLESHEET.slice(start + opening.length, STYLESHEET.indexOf('\n\t}', start))
	const declarations: Record<string, string> = {}
	for (const line of body.split('\n')) {
		const match = /^\s*([-\w]+):\s*(.+);\s*$/.exec(line)
		if (match?.[1] && match[2]) {
			declarations[match[1]] = match[2]
		}
	}
	return declarations
}
