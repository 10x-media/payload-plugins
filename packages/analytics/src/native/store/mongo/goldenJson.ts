import type { Stage } from './pipelines'

const LINE_WIDTH = 100
const TAB_WIDTH = 2

const isPlain = (value: unknown): boolean =>
	Array.isArray(value) ? value.every(isPlain) : value === null || typeof value !== 'object'

const inline = (value: unknown): string =>
	Array.isArray(value) ? `[${value.map(inline).join(', ')}]` : JSON.stringify(value)

/**
 * The pipeline as JSON laid out the way Biome formats the repo's JSON, so the goldens pass its
 * check: objects one key per line, arrays without objects on one line when they fit.
 */
const print = (value: unknown, depth: number, used: number): string => {
	const indent = (level: number): string => '\t'.repeat(level)
	if (value instanceof Date) {
		return print({ $date: value.toISOString() }, depth, used)
	}
	if (Array.isArray(value)) {
		if (value.length === 0) {
			return '[]'
		}
		if (isPlain(value) && used + inline(value).length <= LINE_WIDTH) {
			return inline(value)
		}
		const items = value.map((item, i) => {
			const trailing = i < value.length - 1 ? 1 : 0
			return `${indent(depth + 1)}${print(item, depth + 1, (depth + 1) * TAB_WIDTH + trailing)}`
		})
		return `[\n${items.join(',\n')}\n${indent(depth)}]`
	}
	if (value !== null && typeof value === 'object') {
		const entries = Object.entries(value)
		if (entries.length === 0) {
			return '{}'
		}
		const lines = entries.map(([key, item], i) => {
			const label = `${JSON.stringify(key)}: `
			const trailing = i < entries.length - 1 ? 1 : 0
			const used = (depth + 1) * TAB_WIDTH + label.length + trailing
			return `${indent(depth + 1)}${label}${print(item, depth + 1, used)}`
		})
		return `{\n${lines.join(',\n')}\n${indent(depth)}}`
	}
	return JSON.stringify(value)
}

/** A pipeline as its golden file holds it. */
export const goldenJson = (pipeline: Stage[]): string => `${print(pipeline, 0, 0)}\n`
