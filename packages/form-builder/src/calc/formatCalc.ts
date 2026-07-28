import type { CalcExpression, CalcOp } from './types'

const OP_GLYPHS: Record<CalcOp, string> = {
	'+': '+',
	'-': '−',
	'*': '×',
	'/': '÷',
	'%': '%',
}

const wrap = (
	child: CalcExpression,
	labelOf: (field: string) => string,
	wrapTypes: readonly CalcExpression['type'][] = ['op']
): string => {
	const formatted = formatCalc(child, labelOf)
	return wrapTypes.includes(child.type) ? `(${formatted})` : formatted
}

/** Renders a CalcExpression as a human-readable one-line string for the visual expression builder's live preview. */
export const formatCalc = (expr: CalcExpression, labelOf: (field: string) => string): string => {
	switch (expr.type) {
		case 'lit':
			return String(expr.value)
		case 'ref':
			return labelOf(expr.field)
		case 'neg':
			// Parenthesize a nested `neg` operand too, otherwise "-(-5)" glues into the ambiguous "--5".
			return `−${wrap(expr.operand, labelOf, ['op', 'neg'])}`
		case 'op':
			return `${wrap(expr.left, labelOf)} ${OP_GLYPHS[expr.op]} ${wrap(expr.right, labelOf)}`
		case 'fn':
			return `${expr.fn}(${expr.args.map((arg) => formatCalc(arg, labelOf)).join(', ')})`
		case 'source':
			// The raw registry key; label resolution is the display layer's concern.
			return expr.source
		case 'weight':
			return `weights(${labelOf(expr.field)})`
	}
}
