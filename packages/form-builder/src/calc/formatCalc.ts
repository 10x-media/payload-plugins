import type { CalcExpression, CalcOp } from './types'

const OP_GLYPHS: Record<CalcOp, string> = {
	'+': '+',
	'-': '−',
	'*': '×',
	'/': '÷',
	'%': '%',
}

const wrap = (child: CalcExpression, labelOf: (field: string) => string): string => {
	const formatted = formatCalc(child, labelOf)
	return child.type === 'op' ? `(${formatted})` : formatted
}

/** Renders a CalcExpression as a human-readable one-line string for the visual expression builder's live preview. */
export const formatCalc = (expr: CalcExpression, labelOf: (field: string) => string): string => {
	switch (expr.type) {
		case 'lit':
			return String(expr.value)
		case 'ref':
			return labelOf(expr.field)
		case 'neg':
			return `−${wrap(expr.operand, labelOf)}`
		case 'op':
			return `${wrap(expr.left, labelOf)} ${OP_GLYPHS[expr.op]} ${wrap(expr.right, labelOf)}`
		case 'fn':
			return `${expr.fn}(${expr.args.map((arg) => formatCalc(arg, labelOf)).join(', ')})`
		case 'weight':
			return `weights(${labelOf(expr.field)})`
	}
}
