import type { Payload, PayloadRequest } from 'payload'
import type { FormFieldInstance } from '../submissions/types'
import { calcExpressionOf } from './computeCalcFields'
import { type CalcResolved, calcWeightKey } from './evaluate'
import type { CalcSource, CalcWeightResolveArgs } from './registry'
import { type CalcExpression, MAX_DEPTH } from './types'

type CalcSourceUsage = {
	scalars: Set<string>
	/** Keyed by `calcWeightKey(source, field)`, deduped across expressions. */
	weightPairs: Map<string, { source: string; field: string }>
}

const collectNode = (expr: CalcExpression, usage: CalcSourceUsage, depth: number): void => {
	if (depth > MAX_DEPTH || expr == null || typeof expr !== 'object') return
	switch (expr.type) {
		case 'source':
			usage.scalars.add(expr.source)
			return
		case 'weight':
			if (typeof expr.source === 'string') {
				usage.weightPairs.set(calcWeightKey(expr.source, expr.field), {
					source: expr.source,
					field: expr.field,
				})
			}
			return
		case 'op':
			collectNode(expr.left, usage, depth + 1)
			collectNode(expr.right, usage, depth + 1)
			return
		case 'neg':
			collectNode(expr.operand, usage, depth + 1)
			return
		case 'fn':
			if (Array.isArray(expr.args)) {
				for (const arg of expr.args) collectNode(arg, usage, depth + 1)
			}
			return
		default:
			return
	}
}

const usageOf = (fields: FormFieldInstance[]): CalcSourceUsage => {
	const usage: CalcSourceUsage = { scalars: new Set(), weightPairs: new Map() }
	for (const field of fields) {
		const expr = calcExpressionOf(field)
		if (expr) collectNode(expr, usage, 0)
	}
	return usage
}

/** Whether any calc field's expression references a registered calc source (scalar or weight mode). */
export const calcUsesSources = (fields: FormFieldInstance[]): boolean => {
	const usage = usageOf(fields)
	return usage.scalars.size > 0 || usage.weightPairs.size > 0
}

export type ResolveCalcContextArgs = {
	fields: FormFieldInstance[]
	/** The registered calc sources (plugin option `calc.sources`). */
	sources: Record<string, CalcSource>
	form: { id: number | string } & Record<string, unknown>
	payload: Payload
	req?: PayloadRequest
}

/**
 * Resolve every calc source a form's expressions reference: used scalar keys through `resolve`,
 * used (source, field) weight pairs through `resolveWeights` with the referenced field instance,
 * each exactly once. A weight pair whose field instance is missing resolves to an empty map. A
 * used-but-unregistered key (or a mode the source does not implement) and any resolver failure
 * THROW: these values are money math, so the caller decides how loud a failure is (submit rejects,
 * the render hook catches and degrades). Custom functions are not resolved here; they come straight
 * off the registry per environment.
 */
export const resolveCalcContext = async ({
	fields,
	sources,
	form,
	payload,
	req,
}: ResolveCalcContextArgs): Promise<CalcResolved> => {
	const usage = usageOf(fields)
	if (usage.scalars.size === 0 && usage.weightPairs.size === 0) {
		return {}
	}
	const resolvedSources: Record<string, number> = {}
	for (const key of usage.scalars) {
		const source = sources[key]
		if (!source?.resolve) {
			throw new Error(
				`@10x-media/form-builder: calculation expression references source "${key}", which is not registered or has no \`resolve\`.`
			)
		}
		resolvedSources[key] = await source.resolve({ form, payload, req })
	}
	const resolvedWeights: Record<string, Record<string, number>> = {}
	for (const [key, pair] of usage.weightPairs) {
		const source = sources[pair.source]
		if (!source?.resolveWeights) {
			throw new Error(
				`@10x-media/form-builder: calculation expression references weights from source "${pair.source}", which is not registered or has no \`resolveWeights\`.`
			)
		}
		const instance = fields.find((field) => field.name === pair.field)
		resolvedWeights[key] = instance
			? await source.resolveWeights({
					form,
					payload,
					req,
					field: instance as CalcWeightResolveArgs['field'],
				})
			: {}
	}
	return {
		...(usage.scalars.size > 0 ? { sources: resolvedSources } : {}),
		...(usage.weightPairs.size > 0 ? { weights: resolvedWeights } : {}),
	}
}
