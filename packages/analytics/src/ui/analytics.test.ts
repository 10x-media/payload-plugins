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

	it('defines every documented token on :root, on Payload 4 variables with a fallback', () => {
		const root = declarationsOf(':root')
		for (const token of [
			'--analytics-chart-1',
			'--analytics-chart-comparison',
			'--analytics-card-bg',
			'--analytics-card-border',
			'--analytics-card-radius',
			'--analytics-card-padding',
			'--analytics-text-muted',
			'--analytics-bar-fill',
			'--analytics-bar-label',
			'--analytics-bar-label-on-fill',
			'--analytics-delta-up-fg',
			'--analytics-delta-up-bg',
			'--analytics-delta-down-fg',
			'--analytics-delta-down-bg',
		]) {
			expect(root[token], token).toMatch(/var\(--(color|radius|spacer)-[\w-]+, [^)]+\)/)
		}
	})

	// Payload 4 retired the v3 theme variables; one left behind resolves to nothing.
	it('reads only variables Payload 4 or the stylesheet itself defines', () => {
		const defined = payloadVariables()
		const own = new Set(
			[...analyticsCss().matchAll(/(--analytics-[\w-]+)\s*:/g)].map((match) => match[1] ?? '')
		)
		const unknown = [
			...new Set([...analyticsCss().matchAll(/var\((--[\w-]+)/g)].map((m) => m[1] ?? '')),
		]
			.filter((name) => !defined.has(name) && !own.has(name))
			.filter((name) => !/^--analytics-(bar|chart-height|rows|x|y)$/.test(name))
		expect(unknown).toEqual([])
	})

	it('sizes nothing in rem, whose root differs between Payload versions', () => {
		expect(withoutComments(analyticsCss())).not.toMatch(/\d(\.\d+)?rem\b/)
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
		expect(forced).toContain('border-block-end: 4px solid CanvasText;')
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

/** The directory of `@payloadcms/ui`'s global stylesheets: its tokens, its palette, its themes. */
const payloadCssDir = (): string =>
	dirname(createRequire(import.meta.url).resolve('@payloadcms/ui/css/app.css'))

const declarationsIn = (block: string): Map<string, string> =>
	new Map(
		[...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [
			match[1] ?? '',
			(match[2] ?? '').trim(),
		])
	)

/** Every custom property Payload 4's admin CSS declares, its components' own included. */
const payloadVariables = (): Set<string> => {
	const sheets = (dir: string): string[] =>
		readdirSync(dir).flatMap((name) => {
			const path = join(dir, name)
			if (statSync(path).isDirectory()) {
				return sheets(path)
			}
			return path.endsWith('.css') ? [path] : []
		})
	return new Set(
		sheets(join(payloadCssDir(), '..')).flatMap((path) => [
			...declarationsIn(readFileSync(path, 'utf8')).keys(),
		])
	)
}

type Theme = 'light' | 'dark'

/** Payload's palette, light and dark: the raw ramp, then the theme tokens built on it. */
const payloadPalette = (): Record<Theme, Map<string, string>> => {
	const ramp = declarationsIn(readFileSync(join(payloadCssDir(), 'design-tokens.css'), 'utf8'))
	const colors = readFileSync(join(payloadCssDir(), 'colors.css'), 'utf8')
	const darkAt = colors.indexOf("[data-theme='dark'] {")
	const enhancedAt = colors.indexOf('html[data-enhanced-contrast]')
	const light = new Map([...ramp, ...declarationsIn(colors.slice(0, darkAt))])
	return {
		light,
		dark: new Map([...light, ...declarationsIn(colors.slice(darkAt, enhancedAt))]),
	}
}

/** An sRGB color with its alpha, channels 0 to 255 and alpha 0 to 1. */
type Rgba = [number, number, number, number]

/** The arguments of a CSS function, split on its top-level commas. */
const argumentsOf = (call: string): string[] => {
	const inner = call.slice(call.indexOf('(') + 1, call.lastIndexOf(')'))
	const parts: string[] = []
	let depth = 0
	let current = ''
	for (const char of inner) {
		if (char === ',' && depth === 0) {
			parts.push(current.trim())
			current = ''
			continue
		}
		depth += char === '(' ? 1 : char === ')' ? -1 : 0
		current += char
	}
	return [...parts, current.trim()]
}

const PERCENT = /\s(\d+(?:\.\d+)?)%$/

/**
 * A color value as the admin computes it: a hex or `rgb()`/`rgba()` literal, a variable resolved
 * through the palette (its fallback when the palette lacks it, as on a page outside the admin), or
 * an sRGB `color-mix()` of either.
 */
const colorOf = (palette: Map<string, string>, value: string): Rgba => {
	const css = value.trim()
	if (css.startsWith('var(')) {
		const [name = '', fallback = ''] = argumentsOf(css)
		return colorOf(palette, palette.get(name) ?? fallback)
	}
	if (css.startsWith('color-mix(')) {
		const [, first = '', second = ''] = argumentsOf(css)
		const share = Number(PERCENT.exec(first)?.[1] ?? 50) / 100
		const a = colorOf(palette, first.replace(PERCENT, ''))
		const b = colorOf(palette, second)
		const alpha = a[3] * share + b[3] * (1 - share)
		const channel = (i: 0 | 1 | 2) => (a[i] * a[3] * share + b[i] * b[3] * (1 - share)) / alpha
		return [channel(0), channel(1), channel(2), alpha]
	}
	if (css.startsWith('#')) {
		const hex = css.slice(1)
		const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex
		const byte = (at: number) => Number.parseInt(full.slice(at, at + 2), 16)
		return [byte(0), byte(2), byte(4), full.length === 8 ? byte(6) / 255 : 1]
	}
	const [r = Number.NaN, g = Number.NaN, b = Number.NaN, a = 1] = argumentsOf(css).map(Number)
	return [r, g, b, a]
}

/** `top` painted over an opaque `under`. */
const over = (top: Rgba, under: Rgba): Rgba => [
	top[0] * top[3] + under[0] * (1 - top[3]),
	top[1] * top[3] + under[1] * (1 - top[3]),
	top[2] * top[3] + under[2] * (1 - top[3]),
	1,
]

const contrast = (a: Rgba, b: Rgba): number => {
	const luminance = (rgb: Rgba) => {
		const [r = 0, g = 0, bl = 0] = rgb.slice(0, 3).map((channel) => {
			const s = channel / 255
			return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
		})
		return 0.2126 * r + 0.7152 * g + 0.0722 * bl
	}
	const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
	return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05)
}

/** The contrast of `text` on `surface`, both CSS values, the surface laid on the page. */
const ratioOn = (theme: Theme, text: string, surface: string): number => {
	const palette = payloadPalette()[theme]
	const page = over(colorOf(palette, 'var(--color-bg)'), [255, 255, 255, 1])
	const ground = over(colorOf(palette, surface), page)
	return contrast(over(colorOf(palette, text), ground), ground)
}

/** Every innermost rule: its selector and the declarations in it. */
const cssRules = (): Array<{ selector: string; declarations: Map<string, string> }> =>
	[...withoutComments(analyticsCss()).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
		selector: (match[1] ?? '').trim().replace(/\s+/g, ' '),
		declarations: new Map(
			[...(match[2] ?? '').matchAll(/([-\w]+)\s*:\s*([^;]+);/g)].map((declaration) => [
				declaration[1] ?? '',
				(declaration[2] ?? '').trim().replace(/\s*\n\s*/g, ' '),
			])
		),
	}))

const THEMES = ['light', 'dark'] as const

describe('muted text', () => {
	it('is one token, secondary text pulled toward the body text as the activity widget does', () => {
		expect(declarationsOf(':root')['--analytics-text-muted']).toBe(
			'color-mix(in srgb, var(--color-text-secondary, #808080) 75%, var(--color-text, #1a1a1a))'
		)
		const fainter = cssRules().flatMap(({ selector, declarations }) => {
			const color = declarations.get('color') ?? ''
			return /--color-text-(secondary|tertiary|disabled)/.test(color)
				? [`${selector}: ${color}`]
				: []
		})
		expect(fainter).toEqual([])
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

	it('reads at 4.5:1 or better on a card, a hovered or pressed card and a tooltip, in both themes', () => {
		const muted = declarationsOf(':root')['--analytics-text-muted'] ?? ''
		for (const theme of THEMES) {
			for (const surface of [
				'var(--color-bg)',
				'var(--color-bg-secondary)',
				'var(--color-bg-elevated)',
			]) {
				expect(ratioOn(theme, muted, surface), `${theme} on ${surface}`).toBeGreaterThanOrEqual(4.5)
			}
		}
	})
})

describe('bar labels', () => {
	it('read at 4.5:1 or better on a soft bar, a hovered soft one, a solid one and a hovered solid one, in both themes', () => {
		const root = declarationsOf(':root')
		const hover = declarationsOf('.analytics-bars__row:hover .analytics-bars__track::before')
		expect(hover.filter).toBe('brightness(0.9)')
		const soft =
			declarationsOf('.analytics-bars--soft .analytics-bars__track::before').background ?? ''
		const track = declarationsOf('.analytics-bars--soft .analytics-bars__track').background ?? ''
		const softHover = declarationsOf(
			'.analytics-bars--soft .analytics-bars__row:hover .analytics-bars__track::before'
		)
		expect(softHover.filter).toBe('none')
		const label = root['--analytics-bar-label'] ?? ''
		for (const theme of THEMES) {
			const palette = payloadPalette()[theme]
			const fill = colorOf(palette, root['--analytics-bar-fill'] ?? '')
			const onFill = colorOf(palette, root['--analytics-bar-label-on-fill'] ?? '')
			const darker: Rgba = [fill[0] * 0.9, fill[1] * 0.9, fill[2] * 0.9, 1]
			expect(contrast(onFill, fill), `solid ${theme}`).toBeGreaterThanOrEqual(4.5)
			expect(contrast(onFill, darker), `hovered ${theme}`).toBeGreaterThanOrEqual(4.5)
			expect(ratioOn(theme, label, soft), `soft ${theme}`).toBeGreaterThanOrEqual(4.5)
			expect(
				ratioOn(theme, label, softHover.background ?? ''),
				`soft hovered ${theme}`
			).toBeGreaterThanOrEqual(4.5)
			expect(ratioOn(theme, label, track), `track ${theme}`).toBeGreaterThanOrEqual(4.5)
		}
	})
})

describe('the delta pills', () => {
	it("sit on Payload's success and error pill fills, the unchanged one untouched", () => {
		const root = declarationsOf(':root')
		expect(root['--analytics-delta-up-bg']).toMatch(/^var\(--color-bg-selected,/)
		expect(root['--analytics-delta-down-bg']).toMatch(/^var\(--color-bg-danger-tertiary,/)
		expect(root['--analytics-delta-up-fg']).toMatch(/^color-mix\(in srgb, var\(--color-text-brand,/)
		expect(root['--analytics-delta-down-fg']).toMatch(
			/^color-mix\(in srgb, var\(--color-text-danger,/
		)
		expect(declarationsOf('.analytics-delta__change--none')).toEqual({})
	})

	it('read at 4.5:1 or better in the light theme and the dark one', () => {
		const root = declarationsOf(':root')
		const pills = {
			up: [root['--analytics-delta-up-fg'], root['--analytics-delta-up-bg']],
			down: [root['--analytics-delta-down-fg'], root['--analytics-delta-down-bg']],
			// Payload's own light-gray pill.
			none: ['var(--color-text)', 'var(--color-bg-secondary)'],
		}
		for (const theme of THEMES) {
			for (const [tone, [fg = '', bg = '']] of Object.entries(pills)) {
				expect(ratioOn(theme, fg, bg), `${tone} ${theme}`).toBeGreaterThanOrEqual(4.5)
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
