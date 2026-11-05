import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { analyticsCss, declarationsOf } from '../testing/stylesheet'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE = join(SRC, '..')

const modules = (dir: string): string[] =>
	readdirSync(dir).flatMap((name) => {
		const path = join(dir, name)
		if (statSync(path).isDirectory()) {
			return modules(path)
		}
		return /\.tsx?$/.test(path) && !path.includes('.test.') ? [path] : []
	})

/** Each stylesheet a module under `src` imports, resolved, with the module importing it. */
const stylesheetImports = (): Array<{ from: string; target: string }> =>
	modules(SRC).flatMap((path) =>
		[...readFileSync(path, 'utf8').matchAll(/^import\s+['"]([^'"]+\.css)['"]/gm)].map((match) => ({
			from: relative(SRC, path),
			target: relative(SRC, resolve(dirname(path), match[1] ?? '')),
		}))
	)

const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

describe('the package stylesheet', () => {
	it('declares Payload layer order first and puts every rule in the payload layer', () => {
		const css = withoutComments(analyticsCss()).trim()
		expect(css.startsWith('@layer payload-default, payload;\n')).toBe(true)
		const rest = css.slice('@layer payload-default, payload;'.length).trim()
		expect(rest.startsWith('@layer payload {')).toBe(true)
		let depth = 0
		let closedAt = -1
		for (let i = rest.indexOf('{'); i < rest.length; i++) {
			if (rest[i] === '{') depth++
			if (rest[i] === '}') depth--
			if (depth === 0) {
				closedAt = i
				break
			}
		}
		expect(closedAt).toBe(rest.length - 1)
	})

	it('defines every documented token on :root, on Payload theme variables', () => {
		const root = declarationsOf(':root')
		for (const token of [
			'--analytics-chart-1',
			'--analytics-chart-comparison',
			'--analytics-card-bg',
			'--analytics-card-border',
			'--analytics-card-radius',
			'--analytics-card-padding',
			'--analytics-bar-fill',
			'--analytics-bar-label',
			'--analytics-bar-label-on-fill',
			'--analytics-delta-up-fg',
			'--analytics-delta-up-bg',
			'--analytics-delta-down-fg',
			'--analytics-delta-down-bg',
		]) {
			expect(root[token], token).toMatch(/var\(--(theme-|style-|base\b|color-|analytics-)/)
		}
	})

	it('reads no variable Payload does not define', () => {
		expect(analyticsCss()).not.toContain('--theme-base-')
	})

	// A label past the end of a short bar sits on bare track, so it cannot stay the bar's color.
	it('paints a bar label one color over the bar and another past its end', () => {
		const label = declarationsOf('.analytics-bars__label')
		expect(label.color).toBe('transparent')
		expect(label['background-clip']).toBe('text')
		expect(analyticsCss()).toContain(
			'var(--analytics-bar-label-on-fill) var(--analytics-bar, 0%),\n\t\t\tvar(--analytics-bar-label) var(--analytics-bar, 0%)'
		)
	})

	// Read off the track, which a left-to-right label inside it (a path) does not turn around.
	it('grows a bar and its light label from the right on a right-to-left page', () => {
		expect(declarationsOf('.analytics-bars__track::before')['inset-inline-start']).toBe('0')
		expect(analyticsCss()).toContain(
			'.analytics-bars__track:is(:dir(rtl), [dir="rtl"] *) .analytics-bars__label {\n\t\tbackground: linear-gradient(\n\t\t\tto left,'
		)
	})

	// `:is()` drops a selector it cannot read, so a browser without `:dir()` keeps the fallback.
	it('pairs every right-to-left rule with a [dir] fallback inside :is()', () => {
		const css = withoutComments(analyticsCss())
		const every = css.split(':dir(rtl)').length - 1
		const paired = css.split(':is(:dir(rtl), [dir="rtl"] *)').length - 1
		expect(every).toBeGreaterThanOrEqual(6)
		expect(paired).toBe(every)
	})

	it('draws a bar as a rule under its label where forced colors drop the fill', () => {
		const css = withoutComments(analyticsCss())
		const forced = css.slice(css.indexOf('@media (forced-colors: active)'))
		expect(forced).toContain('.analytics-bars__track::before {')
		expect(forced).toContain('border-block-end: 0.25rem solid CanvasText;')
	})

	// The pointer tooltip follows clientX, which is physical whichever way the page reads.
	it('places and spaces everything by logical properties but the pointer tooltip', () => {
		const physical = withoutComments(analyticsCss())
			.split('\n')
			.map((line) => line.trim())
			.filter((line) =>
				/^(left|right|top|bottom|(margin|padding|border)-(left|right|top|bottom)[\w-]*|float|text-align:\s*(left|right)|inset:\s*\S+\s+\S+)/.test(
					line
				)
			)
		expect(physical).toEqual(['left: var(--analytics-x, 0);'])
		expect(declarationsOf('.analytics-chart__tooltip--pointer').left).toBe('var(--analytics-x, 0)')
	})
})

/** Payload's own palette, read from the installed `@payloadcms/ui`, light and dark. */
const payloadPalette = (): { light: Map<string, string>; dark: Map<string, string> } => {
	const scss = readFileSync(
		join(
			dirname(createRequire(import.meta.url).resolve('@payloadcms/ui/scss/app.scss')),
			'colors.scss'
		),
		'utf8'
	)
	const darkAt = scss.indexOf("html[data-theme='dark']")
	const declarations = (block: string) =>
		new Map(
			[...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [
				match[1] ?? '',
				match[2] ?? '',
			])
		)
	const light = declarations(scss.slice(0, darkAt))
	return { light, dark: new Map([...light, ...declarations(scss.slice(darkAt))]) }
}

const rgbOf = (palette: Map<string, string>, variable: string): [number, number, number] => {
	let value = palette.get(variable) ?? ''
	for (let hop = 0; hop < 5 && value.startsWith('var('); hop++) {
		value = palette.get(/var\((--[\w-]+)/.exec(value)?.[1] ?? '') ?? ''
	}
	const [r = Number.NaN, g = Number.NaN, b = Number.NaN] = (/rgb\(([^)]+)\)/.exec(value)?.[1] ?? '')
		.split(',')
		.map(Number)
	return [r, g, b]
}

const contrast = (a: [number, number, number], b: [number, number, number]): number => {
	const luminance = (rgb: [number, number, number]) => {
		const [r = 0, g = 0, bl = 0] = rgb.map((channel) => {
			const s = channel / 255
			return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
		})
		return 0.2126 * r + 0.7152 * g + 0.0722 * bl
	}
	const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
	return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05)
}

/** Every innermost rule: its selector and the declarations in it. */
const cssRules = (): Array<{ selector: string; declarations: Map<string, string> }> =>
	[...withoutComments(analyticsCss()).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
		selector: (match[1] ?? '').trim().replace(/\s+/g, ' '),
		declarations: new Map(
			[...(match[2] ?? '').matchAll(/([-\w]+)\s*:\s*([^;]+);/g)].map((declaration) => [
				declaration[1] ?? '',
				(declaration[2] ?? '').trim(),
			])
		),
	}))

const mix = (
	top: [number, number, number],
	under: [number, number, number],
	share: number
): [number, number, number] => [
	top[0] * share + under[0] * (1 - share),
	top[1] * share + under[1] * (1 - share),
	top[2] * share + under[2] * (1 - share),
]

describe('muted text', () => {
	// Text on an inverted fill: the picked days of a range, light on elevation-800.
	const INVERTED = /react-datepicker__day--range-start/

	it('is one token, elevation 600, which every text color lighter than the body text uses', () => {
		expect(declarationsOf(':root')['--analytics-text-muted']).toMatch(
			/^var\(--theme-elevation-600,/
		)
		const lighter = cssRules().flatMap(({ selector, declarations }) => {
			const color = declarations.get('color')
			const step = Number(/--theme-elevation-(\d+)/.exec(color ?? '')?.[1] ?? Number.NaN)
			return step < 600 && !INVERTED.test(selector) ? [`${selector}: ${color}`] : []
		})
		expect(lighter).toEqual([])
		const muted = cssRules().filter(
			({ declarations }) => declarations.get('color') === 'var(--analytics-text-muted)'
		)
		expect(muted.length).toBeGreaterThan(20)
	})

	// A section dims only while it reloads; nothing at rest reads through an opacity.
	it('dims no text at rest through opacity, which would undo the contrast the token gives', () => {
		const dimmed = cssRules().flatMap(({ selector, declarations }) =>
			declarations.has('opacity') &&
			!/aria-busy="true"|--dimmed$/.test(selector) &&
			!/^(from|to)$/.test(selector)
				? [selector]
				: []
		)
		expect(dimmed).toEqual([])
	})

	it('reads at 4.5:1 or better on the page, a card, a pressed card and a tooltip, in both themes', () => {
		const palette = payloadPalette()
		for (const theme of ['light', 'dark'] as const) {
			const text = rgbOf(palette[theme], '--theme-elevation-600')
			for (const surface of [
				'--theme-elevation-0',
				'--theme-elevation-50',
				'--theme-elevation-100',
			]) {
				const ratio = contrast(text, rgbOf(palette[theme], surface))
				expect(ratio, `${theme} on ${surface}`).toBeGreaterThanOrEqual(4.5)
			}
		}
	})
})

describe('bar labels', () => {
	it('read at 4.5:1 or better on a soft bar, a solid one and a hovered solid one, in both themes', () => {
		const palette = payloadPalette()
		const solid = rgbOf(palette.light, '--color-success-600')
		const white: [number, number, number] = [255, 255, 255]
		const hovered: [number, number, number] = [
			Math.min(255, solid[0] * 1.12),
			Math.min(255, solid[1] * 1.12),
			Math.min(255, solid[2] * 1.12),
		]
		expect(declarationsOf(':root')['--analytics-bar-fill']).toMatch(/^var\(--color-success-600,/)
		expect(declarationsOf('.analytics-bars__row:hover .analytics-bars__track::before').filter).toBe(
			'brightness(1.12)'
		)
		expect(contrast(white, solid)).toBeGreaterThanOrEqual(4.5)
		expect(contrast(white, hovered)).toBeGreaterThanOrEqual(4.5)
		for (const theme of ['light', 'dark'] as const) {
			const track = rgbOf(palette[theme], '--theme-elevation-100')
			const soft = mix(rgbOf(palette[theme], '--theme-success-500'), track, 0.25)
			const label = rgbOf(palette[theme], '--theme-elevation-800')
			expect(contrast(label, soft), `soft ${theme}`).toBeGreaterThanOrEqual(4.5)
			expect(contrast(label, track), `track ${theme}`).toBeGreaterThanOrEqual(4.5)
		}
	})
})

describe('the delta pills', () => {
	// Payload's own Pill styles (elements/Pill/index.scss), which the up and down tokens restate.
	const PILLS = {
		up: ['--theme-success-800', '--theme-success-150'],
		down: ['--theme-error-800', '--theme-error-150'],
		none: ['--theme-elevation-800', '--theme-elevation-100'],
	} as const

	it('take their colors from the Pill styles, the unchanged one untouched', () => {
		const root = declarationsOf(':root')
		expect(root['--analytics-delta-up-fg']).toMatch(/^var\(--theme-success-800,/)
		expect(root['--analytics-delta-up-bg']).toMatch(/^var\(--theme-success-150,/)
		expect(root['--analytics-delta-down-fg']).toMatch(/^var\(--theme-error-800,/)
		expect(root['--analytics-delta-down-bg']).toMatch(/^var\(--theme-error-150,/)
		expect(declarationsOf('.analytics-delta__change--none')).toEqual({})
	})

	it('read at 4.5:1 or better in the light theme and the dark one', () => {
		const palette = payloadPalette()
		for (const theme of ['light', 'dark'] as const) {
			for (const [tone, [fg, bg]] of Object.entries(PILLS)) {
				const ratio = contrast(rgbOf(palette[theme], fg), rgbOf(palette[theme], bg))
				expect(ratio, `${tone} ${theme}`).toBeGreaterThanOrEqual(4.5)
			}
		}
	})
})

describe('shipping the stylesheet', () => {
	it('is the one stylesheet every admin surface imports', () => {
		const imports = stylesheetImports()
		expect(imports.length).toBeGreaterThan(10)
		expect([...new Set(imports.map((entry) => entry.target))]).toEqual([
			join('ui', 'analytics.css'),
		])
		expect(imports.map((entry) => entry.from)).toEqual(
			expect.arrayContaining([
				join('charts', 'BarList.tsx'),
				join('charts', 'TrendChart.tsx'),
				join('widgets', 'WidgetCard.tsx'),
				join('view', 'AnalyticsViewClient.tsx'),
				join('fields', 'AnalyticsPanelClient.tsx'),
				join('fields', 'AnalyticsStatField.tsx'),
				join('fields', 'dateRange', 'ui.tsx'),
				join('goals', 'GoalSelectField.tsx'),
				join('goals', 'GoalAmountField.tsx'),
			])
		)
		expect(existsSync(join(SRC, 'ui', 'analytics.css'))).toBe(true)
	})

	it('is marked a side effect and exported for charts drawn outside the admin', () => {
		const pkg = JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf8')) as {
			sideEffects: unknown
			exports: Record<string, unknown>
			publishConfig: { exports: Record<string, unknown> }
			peerDependencies: Record<string, string>
			devDependencies: Record<string, string>
		}
		expect(pkg.sideEffects).toEqual(['*.css'])
		expect(pkg.exports['./styles.css']).toEqual({
			development: './src/ui/analytics.css',
			default: './dist/ui/analytics.css',
		})
		expect(pkg.publishConfig.exports['./styles.css']).toBe('./dist/ui/analytics.css')
		expect(pkg.peerDependencies['react-datepicker']).toBeUndefined()
		expect(pkg.devDependencies['react-datepicker']).toBeUndefined()
	})
})
