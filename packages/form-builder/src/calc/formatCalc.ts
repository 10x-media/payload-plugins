import type { CalcExpression, CalcOp } from './types'

const OP_GLYPHS: Record<CalcOp, string> = {
	'+': '+',
	'-': '−',
	'*': '×',
	'/': '÷',
	'%': '%',
}

type LabelResolvers = {
	labelOf: (field: string) => string
	sourceLabel: (key: string) => string
}

const wrap = (
	child: CalcExpression,
	resolvers: LabelResolvers,
	wrapTypes: readonly CalcExpression['type'][] = ['op']
): string => {
	const formatted = format(child, resolvers)
	return wrapTypes.includes(child.type) ? `(${formatted})` : formatted
}

const format = (expr: CalcExpression, resolvers: LabelResolvers): string => {
	switch (expr.type) {
		case 'lit':
			return String(expr.value)
		case 'ref':
			return resolvers.labelOf(expr.field)
		case 'neg':
			// Parenthesize a nested `neg` operand too, otherwise "-(-5)" glues into the ambiguous "--5".
			return `−${wrap(expr.operand, resolvers, ['op', 'neg'])}`
		case 'op':
			return `${wrap(expr.left, resolvers)} ${OP_GLYPHS[expr.op]} ${wrap(expr.right, resolvers)}`
		case 'fn':
			return `${expr.fn}(${expr.args.map((arg) => format(arg, resolvers)).join(', ')})`
		case 'source':
			return resolvers.sourceLabel(expr.source)
		case 'weight':
			return `weights(${resolvers.labelOf(expr.field)})`
	}
}

/**
 * Renders a CalcExpression as a human-readable one-line string for the visual expression builder's
 * live preview. `sourceLabel` resolves a calc source key to its display label (raw key when omitted).
 */
export const formatCalc = (
	expr: CalcExpression,
	labelOf: (field: string) => string,
	sourceLabel: (key: string) => string = (key) => key
): string => format(expr, { labelOf, sourceLabel })
