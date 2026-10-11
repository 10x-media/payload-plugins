// biome-ignore-all lint/plugin/noProcessEnv: load harness env boundary (LOAD_SCALE, LOAD_OUT)
import { appendFileSync } from 'node:fs'
import { cpus, totalmem } from 'node:os'
import type { AnalyticsResult } from '../../src/core/contract'

/** `LOAD_SCALE`: every volume is multiplied by it, so 0.05 makes a quick check. */
export const SCALE = Number(process.env.LOAD_SCALE ?? '1')

export interface Measure {
	phase: string
	measure: string
	value: number
	unit: string
	target?: string
}

const measures: Array<Measure & { db: string }> = []

/** Keeps a measure for the results table, and appends it to `LOAD_OUT` as a JSON line when set. */
export const record = (db: string, measure: Measure): void => {
	measures.push({ db, ...measure })
	const out = process.env.LOAD_OUT
	if (out) {
		appendFileSync(out, `${JSON.stringify({ db, ...measure })}\n`)
	}
}

/** The nearest-rank percentile `p` of `values`; NaN when there are none. */
export const percentile = (values: readonly number[], p: number): number => {
	const sorted = [...values].sort((a, b) => a - b)
	if (sorted.length === 0) {
		return Number.NaN
	}
	const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
	return sorted[Math.max(0, index)] ?? Number.NaN
}

const round = (value: number): number => Math.round(value * 10) / 10

/** What a result says about its own numbers: partial, clamped, or served from a snapshot. */
export const flagsOf = (result: AnalyticsResult | undefined): string => {
	const flags = [
		result?.meta.partial ? `partial ${JSON.stringify(result.meta.partial)}` : '',
		result?.meta.clamped ? 'clamped' : '',
		result?.meta.asOf ? 'snapshot' : '',
	].filter(Boolean)
	return flags.length > 0 ? ` (${flags.join(', ')})` : ''
}

/** Prints `db`'s measures as a markdown table under `heading`: the suite's output. */
export const printMeasures = (db: string, heading: string = db): void => {
	const lines = [
		`\n## ${heading} (${cpus().length} cores, ${Math.round(totalmem() / 2 ** 30)} GB, LOAD_SCALE=${SCALE})`,
		'| phase | measure | value | unit | target |',
		'|---|---|---|---|---|',
		...measures
			.filter((m) => m.db === db)
			.map(
				(m) => `| ${m.phase} | ${m.measure} | ${round(m.value)} | ${m.unit} | ${m.target ?? ''} |`
			),
	]
	console.log(lines.join('\n'))
}
