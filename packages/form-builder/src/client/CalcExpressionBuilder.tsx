'use client'

import {
	Button,
	FieldError,
	FieldLabel,
	ReactSelect,
	type ReactSelectOption,
	RenderCustomComponent,
	useField,
	useFormFields,
} from '@payloadcms/ui'
import { reduceFieldsToValues } from 'payload/shared'
import { useMemo, useState } from 'react'
import { formatCalc } from '../calc/formatCalc'
import { normalizeCalc } from '../calc/normalizeCalc'
import {
	CALC_FNS,
	CALC_OPS,
	type CalcExpression,
	type CalcFn,
	type CalcFnName,
	type CalcOp,
	isCalcFn,
} from '../calc/types'
import type { CalcSourceClientMeta } from '../fields/builtin/calculation'
import { keys, type TranslationKey } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import type { FieldRow } from './synthesizeClientField'
import { toStaticLabel } from './toStaticLabel'
import './admin.css'

export type CalcExpressionBuilderProps = {
	path?: string
	field?: { label?: unknown }
	readOnly?: boolean
	/** Registered calc-source metadata (key, label, modes), threaded as clientProps by `buildCalculationField`. */
	sources?: CalcSourceClientMeta[]
	/** Registered custom calc function names, so client-side normalization accepts what the server accepts. */
	functions?: string[]
}

/**
 * The editing view model: authors read and build expressions left-to-right, so the UI edits a
 * chain (first operand, then op+operand steps, then an optional wrapping unary function) and the
 * stored `CalcExpression` AST is derived by left-folding. The AST contract is untouched.
 */
export type CalcChain = { first: CalcOperand; steps: CalcChainStep[]; finish?: CalcFn }
export type CalcChainStep = { op: CalcOp; operand: CalcOperand }
export type CalcOperand =
	| { kind: 'ref'; field: string }
	| { kind: 'lit'; value: number }
	| { kind: 'weight'; field: string; weights?: Record<string, number>; source?: string }
	| { kind: 'source'; source: string }
	| { kind: 'group'; chain: CalcChain }
	| { kind: 'fn'; fn: CalcFnName; args: CalcChain[] }
	| { kind: 'neg'; operand: CalcOperand }

/** Kinds a leaf operand card can switch between in place; containers come from Start with, loading, or JSON. */
type LeafKind = 'lit' | 'ref' | 'weight'
type StartKind = 'fn' | LeafKind

/** The single-argument functions offered by the "Then apply" finisher; min/max are variadic and stay Function operands. */
const UNARY_FNS = CALC_FNS.filter((fn) => fn !== 'min' && fn !== 'max')

const seedOperand = (kind: LeafKind): CalcOperand => {
	switch (kind) {
		case 'ref':
			return { kind: 'ref', field: '' }
		case 'lit':
			return { kind: 'lit', value: 0 }
		case 'weight':
			return { kind: 'weight', field: '', weights: {} }
	}
}

const seedAst = (kind: StartKind): CalcExpression => {
	switch (kind) {
		case 'ref':
			return { type: 'ref', field: '' }
		case 'lit':
			return { type: 'lit', value: 0 }
		case 'weight':
			return { type: 'weight', field: '', weights: {} }
		case 'fn':
			return { type: 'fn', fn: 'min', args: [{ type: 'lit', value: 0 }] }
	}
}

const astToOperand = (node: CalcExpression): CalcOperand => {
	switch (node.type) {
		case 'ref':
			return { kind: 'ref', field: node.field }
		case 'lit':
			return { kind: 'lit', value: node.value }
		case 'source':
			return { kind: 'source', source: node.source }
		case 'weight':
			return {
				kind: 'weight',
				field: node.field,
				...(node.weights !== undefined ? { weights: node.weights } : {}),
				...(node.source !== undefined ? { source: node.source } : {}),
			}
		case 'neg':
			return { kind: 'neg', operand: astToOperand(node.operand) }
		case 'fn':
			return { kind: 'fn', fn: node.fn, args: node.args.map((arg) => toChain(arg, false)) }
		case 'op':
			return { kind: 'group', chain: toChain(node, false) }
	}
}

const toChain = (expr: CalcExpression, allowFinish: boolean): CalcChain => {
	const arg = expr.type === 'fn' ? expr.args[0] : undefined
	if (
		allowFinish &&
		expr.type === 'fn' &&
		expr.args.length === 1 &&
		arg !== undefined &&
		isCalcFn(expr.fn) &&
		(UNARY_FNS as readonly CalcFn[]).includes(expr.fn)
	) {
		return { ...toChain(arg, false), finish: expr.fn }
	}
	const steps: CalcChainStep[] = []
	let node = expr
	while (node.type === 'op') {
		steps.unshift({ op: node.op, operand: astToOperand(node.right) })
		node = node.left
	}
	return { first: astToOperand(node), steps }
}

/**
 * AST -> chain: the left spine of binary ops flattens into first + steps (a nested op on the right
 * becomes a `group`); a root unary fn wrapping the whole expression loads as `finish` (min/max stay
 * fn operands so the finisher select never holds a value it cannot offer). Total: every valid
 * `CalcExpression` loads without loss, and `chainToAst(astToChain(x))` is structurally `x`.
 */
export const astToChain = (expr: CalcExpression): CalcChain => toChain(expr, true)

const operandToAst = (operand: CalcOperand): CalcExpression => {
	switch (operand.kind) {
		case 'ref':
			return { type: 'ref', field: operand.field }
		case 'lit':
			return { type: 'lit', value: operand.value }
		case 'weight':
			return {
				type: 'weight',
				field: operand.field,
				...(operand.weights !== undefined ? { weights: operand.weights } : {}),
				...(operand.source !== undefined ? { source: operand.source } : {}),
			}
		case 'source':
			return { type: 'source', source: operand.source }
		case 'neg':
			return { type: 'neg', operand: operandToAst(operand.operand) }
		case 'fn':
			return { type: 'fn', fn: operand.fn, args: operand.args.map(chainBodyToAst) }
		case 'group':
			return chainBodyToAst(operand.chain)
	}
}

/** Folds first + steps only. `finish` is root-only by design: nested chains (groups, fn args) never carry one, so it is deliberately ignored here. */
const chainBodyToAst = (chain: CalcChain): CalcExpression =>
	chain.steps.reduce<CalcExpression>(
		(left, step) => ({ type: 'op', op: step.op, left, right: operandToAst(step.operand) }),
		operandToAst(chain.first)
	)

/** Chain -> AST: left-fold first + steps into the binary tree (left-assoc matches `-`/`/`/`%`), then wrap in `finish` when set. */
export const chainToAst = (chain: CalcChain): CalcExpression => {
	const body = chainBodyToAst(chain)
	return chain.finish ? { type: 'fn', fn: chain.finish, args: [body] } : body
}

type ChoiceOption = { label: string; value: string }
type ChoiceSibling = { name: string; label: string; options: ChoiceOption[] }
type Siblings = {
	numeric: ChoiceOption[]
	choices: ChoiceSibling[]
	labels: Record<string, string>
}

const optionRows = (options: unknown): ChoiceOption[] => {
	if (!Array.isArray(options)) {
		return []
	}
	return options.flatMap((option) => {
		if (typeof option === 'string') {
			return option.length > 0 ? [{ label: option, value: option }] : []
		}
		if (!option || typeof option !== 'object') {
			return []
		}
		const { label, value } = option as { label?: unknown; value?: unknown }
		if (typeof value !== 'string' || value.length === 0) {
			return []
		}
		return [{ label: typeof label === 'string' && label.length > 0 ? label : value, value }]
	})
}

const siblingsFromData = (data: Record<string, unknown>, selfIndex: number): Siblings => {
	const rows = Array.isArray(data.fields) ? (data.fields as unknown[]) : []
	const siblings: Siblings = { numeric: [], choices: [], labels: {} }
	rows.forEach((row, index) => {
		if (!row || typeof row !== 'object') {
			return
		}
		const { blockType, name, label, options } = row as FieldRow
		const trimmed = typeof name === 'string' ? name.trim() : ''
		if (trimmed.length === 0) {
			return
		}
		const display = typeof label === 'string' && label.length > 0 ? label : trimmed
		siblings.labels[trimmed] = display
		// Calculations fold in declaration order, so a calculation is only referenceable when it is
		// declared before this one; a forward (or self) reference would always evaluate to 0.
		const referenceable =
			blockType === 'number' || (blockType === 'calculation' && index < selfIndex)
		if (referenceable) {
			siblings.numeric.push({ label: display, value: trimmed })
		}
		if (blockType === 'select') {
			siblings.choices.push({ name: trimmed, label: display, options: optionRows(options) })
		}
	})
	return siblings
}

const singleOption = (
	selected: ReactSelectOption | ReactSelectOption[] | null
): ReactSelectOption | undefined => {
	const chosen = Array.isArray(selected) ? selected[0] : selected
	return chosen ?? undefined
}

/** Keeps a stored reference selectable even when it no longer matches any option, like FieldNameSelect. */
const withStored = (options: ChoiceOption[], stored: string): ChoiceOption[] =>
	stored.length > 0 && !options.some((option) => option.value === stored)
		? [...options, { label: stored, value: stored }]
		: options

type NumberInputProps = {
	value: number | undefined
	onCommit: (value: number) => void
	className: string
	id?: string
	disabled?: boolean
	'aria-label'?: string
}

/**
 * Number input with a local draft: keystrokes commit only when the text parses to a finite number,
 * an invalid draft reverts to the committed value on blur, and an external value change resyncs
 * the draft.
 */
const NumberInput = ({
	value,
	onCommit,
	className,
	id,
	disabled,
	'aria-label': ariaLabel,
}: NumberInputProps) => {
	const [draft, setDraft] = useState(value === undefined ? '' : String(value))
	const [lastValue, setLastValue] = useState(value)
	if (value !== lastValue) {
		setLastValue(value)
		if (draft.trim() === '' || Number(draft) !== value) {
			setDraft(value === undefined ? '' : String(value))
		}
	}
	return (
		<input
			type="number"
			className={className}
			id={id}
			disabled={disabled}
			aria-label={ariaLabel}
			value={draft}
			onChange={(event) => {
				const text = event.target.value
				setDraft(text)
				const parsed = Number(text)
				if (text.trim() !== '' && Number.isFinite(parsed)) {
					onCommit(parsed)
				}
			}}
			onBlur={() => {
				const parsed = Number(draft)
				if (draft.trim() === '' || !Number.isFinite(parsed)) {
					setDraft(value === undefined ? '' : String(value))
				}
			}}
		/>
	)
}

type BuilderCtx = {
	t: (key: TranslationKey) => string
	siblings: Siblings
	readOnly: boolean
	/** Resolves a calc source key to its admin-locale display label (raw key when unregistered). */
	sourceLabelOf: (key: string) => string
	/** Scalar-capable sources as select options (`source:`-prefixed values). */
	scalarSourceOptions: ChoiceOption[]
	/** Weights-capable sources as select options (`source:`-prefixed values). */
	weightSourceOptions: ChoiceOption[]
	/** Registered custom calc function names, offered by the fn select after the built-ins. */
	customFnOptions: ChoiceOption[]
}

const OP_OPTIONS: ChoiceOption[] = CALC_OPS.map((op) => ({ label: op, value: op }))
const FN_OPTIONS: ChoiceOption[] = CALC_FNS.map((fn) => ({ label: fn, value: fn }))
const UNARY_OPTIONS: ChoiceOption[] = UNARY_FNS.map((fn) => ({ label: fn, value: fn }))

/** Source entries share kind/start selects with the fixed kinds, namespaced to avoid key collisions. */
const SOURCE_PREFIX = 'source:'
const sourceOptionValue = (key: string): string => `${SOURCE_PREFIX}${key}`
const sourceKeyOf = (value: string): string | undefined =>
	value.startsWith(SOURCE_PREFIX) ? value.slice(SOURCE_PREFIX.length) : undefined

/** A source label is a plain string or a per-locale record; resolve it for the admin UI language. */
const resolveSourceLabel = (label: string | Record<string, string>, language: string): string =>
	typeof label === 'string' ? label : (label[language] ?? label.en ?? Object.values(label)[0] ?? '')

type SelectOptionOrGroup = ChoiceOption | { label: string; options: ChoiceOption[] }

/** Fixed kinds stay flat; sources join as a labeled group when any exist (react-select mixes both). */
const withSourceGroup = (
	base: ChoiceOption[],
	sourceOptions: ChoiceOption[],
	groupLabel: string
): SelectOptionOrGroup[] =>
	sourceOptions.length > 0 ? [...base, { label: groupLabel, options: sourceOptions }] : base

type OperandCardProps = {
	operand: CalcOperand
	onChange: (next: CalcOperand) => void
	ctx: BuilderCtx
	idPrefix: string
}

const OperandCard = ({ operand, onChange, ctx, idPrefix }: OperandCardProps) => {
	const { t, siblings, readOnly } = ctx

	if (operand.kind === 'group') {
		return (
			<div className="fb-calc-operand fb-calc-operand--group">
				<div className="fb-calc-operand__title">{t(keys.calcBuilderGroup)}</div>
				<ChainEditor
					chain={operand.chain}
					onChange={(chain) => onChange({ ...operand, chain })}
					ctx={ctx}
					idPrefix={`${idPrefix}-g`}
				/>
			</div>
		)
	}

	if (operand.kind === 'fn') {
		const fnOptions = withStored([...FN_OPTIONS, ...ctx.customFnOptions], operand.fn)
		return (
			<div className="fb-calc-operand fb-calc-operand--fn">
				<div className="fb-calc-operand__header">
					<label className="fb-visually-hidden" htmlFor={`${idPrefix}-fn`}>
						{t(keys.calcBuilderFunction)}
					</label>
					<ReactSelect
						className="fb-calc-operand__fn"
						inputId={`${idPrefix}-fn`}
						options={fnOptions}
						value={fnOptions.find((option) => option.value === operand.fn)}
						isClearable={false}
						disabled={readOnly}
						onChange={(selected) => {
							const chosen = singleOption(selected)
							if (chosen) {
								onChange({ ...operand, fn: String(chosen.value) })
							}
						}}
					/>
				</div>
				<div className="fb-calc-fn__args">
					{operand.args.map((arg, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: args are positional and never reordered
						<div key={index} className="fb-calc-fn__arg">
							<div className="fb-calc-fn__arg-chain">
								<ChainEditor
									chain={arg}
									onChange={(next) =>
										onChange({
											...operand,
											args: operand.args.map((a, i) => (i === index ? next : a)),
										})
									}
									ctx={ctx}
									idPrefix={`${idPrefix}-a${index}`}
								/>
							</div>
							{operand.args.length > 1 ? (
								<div className="fb-calc-fn__arg-remove">
									<Button
										buttonStyle="icon-label"
										icon="x"
										aria-label={t(keys.calcBuilderRemove)}
										margin={false}
										disabled={readOnly}
										onClick={() =>
											onChange({
												...operand,
												args: operand.args.filter((_, i) => i !== index),
											})
										}
									/>
								</div>
							) : null}
						</div>
					))}
					<div className="fb-calc-fn__add">
						<Button
							buttonStyle="icon-label"
							icon="plus"
							iconStyle="with-border"
							iconPosition="left"
							margin={false}
							disabled={readOnly}
							onClick={() =>
								onChange({
									...operand,
									args: [...operand.args, { first: { kind: 'lit', value: 0 }, steps: [] }],
								})
							}
						>
							{t(keys.calcBuilderAddArgument)}
						</Button>
					</div>
				</div>
			</div>
		)
	}

	if (operand.kind === 'neg') {
		return (
			<div className="fb-calc-operand fb-calc-operand--neg">
				<div className="fb-calc-operand__title">{t(keys.calcBuilderNegate)}</div>
				<OperandCard
					operand={operand.operand}
					onChange={(next) => onChange({ kind: 'neg', operand: next })}
					ctx={ctx}
					idPrefix={`${idPrefix}-n`}
				/>
			</div>
		)
	}

	const leafKindOptions: ChoiceOption[] = [
		{ label: t(keys.calcBuilderAnswer), value: 'ref' },
		{ label: t(keys.calcBuilderNumber), value: 'lit' },
		{ label: t(keys.calcBuilderWeights), value: 'weight' },
	]
	const kindValue = operand.kind === 'source' ? sourceOptionValue(operand.source) : operand.kind
	const kindSourceOptions =
		operand.kind === 'source' &&
		!ctx.scalarSourceOptions.some((option) => option.value === sourceOptionValue(operand.source))
			? [...ctx.scalarSourceOptions, { label: operand.source, value: kindValue }]
			: ctx.scalarSourceOptions
	const kindFlat = [...leafKindOptions, ...kindSourceOptions]
	const refOptions = operand.kind === 'ref' ? withStored(siblings.numeric, operand.field) : []
	const choiceOptions =
		operand.kind === 'weight'
			? withStored(
					siblings.choices.map((c) => ({ label: c.label, value: c.name })),
					operand.field
				)
			: []
	const choice =
		operand.kind === 'weight' ? siblings.choices.find((c) => c.name === operand.field) : undefined
	const weightSource = operand.kind === 'weight' ? operand.source : undefined
	const weightValuesOptions: ChoiceOption[] = [
		{ label: t(keys.calcBuilderWeightManual), value: 'manual' },
		...(weightSource !== undefined &&
		!ctx.weightSourceOptions.some((option) => option.value === sourceOptionValue(weightSource))
			? [
					...ctx.weightSourceOptions,
					{ label: weightSource, value: sourceOptionValue(weightSource) },
				]
			: ctx.weightSourceOptions),
	]

	return (
		<div className="fb-calc-operand">
			<div className="fb-calc-operand__header">
				<label className="fb-visually-hidden" htmlFor={`${idPrefix}-kind`}>
					{t(keys.calcBuilderKind)}
				</label>
				<ReactSelect
					className="fb-calc-operand__kind"
					inputId={`${idPrefix}-kind`}
					options={
						withSourceGroup(
							leafKindOptions,
							kindSourceOptions,
							t(keys.calcBuilderSourcesGroup)
						) as ReactSelectOption[]
					}
					value={kindFlat.find((option) => option.value === kindValue)}
					isClearable={false}
					disabled={readOnly}
					onChange={(selected) => {
						const chosen = singleOption(selected)
						if (!chosen || chosen.value === kindValue) {
							return
						}
						const sourceKey = sourceKeyOf(String(chosen.value))
						onChange(
							sourceKey !== undefined
								? { kind: 'source', source: sourceKey }
								: seedOperand(chosen.value as LeafKind)
						)
					}}
				/>
				{operand.kind === 'source' ? (
					<span className="fb-calc-operand__source">{ctx.sourceLabelOf(operand.source)}</span>
				) : null}
				{operand.kind === 'ref' ? (
					refOptions.length === 0 ? (
						<p className="fb-calc-hint">{t(keys.calcBuilderNoNumericFields)}</p>
					) : (
						<>
							<label className="fb-visually-hidden" htmlFor={`${idPrefix}-ref`}>
								{t(keys.calcBuilderPickField)}
							</label>
							<ReactSelect
								className="fb-calc-operand__ref"
								inputId={`${idPrefix}-ref`}
								options={refOptions}
								value={refOptions.find((option) => option.value === operand.field)}
								isClearable={!readOnly}
								disabled={readOnly}
								placeholder={t(keys.calcBuilderPickField)}
								onChange={(selected) => {
									const chosen = singleOption(selected)
									onChange({ kind: 'ref', field: chosen ? String(chosen.value) : '' })
								}}
							/>
						</>
					)
				) : null}
				{operand.kind === 'lit' ? (
					<NumberInput
						className="fb-calc-operand__number"
						id={`${idPrefix}-number`}
						aria-label={t(keys.calcBuilderNumber)}
						disabled={readOnly}
						value={operand.value}
						onCommit={(value) => onChange({ kind: 'lit', value })}
					/>
				) : null}
				{operand.kind === 'weight' ? (
					choiceOptions.length === 0 ? (
						<p className="fb-calc-hint">{t(keys.calcBuilderNoChoiceFields)}</p>
					) : (
						<>
							<label className="fb-visually-hidden" htmlFor={`${idPrefix}-weight-field`}>
								{t(keys.calcBuilderPickField)}
							</label>
							<ReactSelect
								className="fb-calc-operand__weight-field"
								inputId={`${idPrefix}-weight-field`}
								options={choiceOptions}
								value={choiceOptions.find((option) => option.value === operand.field)}
								isClearable={!readOnly}
								disabled={readOnly}
								placeholder={t(keys.calcBuilderPickField)}
								onChange={(selected) => {
									const chosen = singleOption(selected)
									const field = chosen ? String(chosen.value) : ''
									if (field !== operand.field) {
										// Inline weights are per-option and reset with the field; a source keeps
										// resolving (its resolver receives the newly chosen field).
										onChange(
											operand.source !== undefined
												? { kind: 'weight', field, source: operand.source }
												: { kind: 'weight', field, weights: {} }
										)
									}
								}}
							/>
						</>
					)
				) : null}
			</div>
			{operand.kind === 'weight' && ctx.weightSourceOptions.length > 0 ? (
				<div className="fb-calc-operand__weight-values-row">
					<label className="fb-calc-operand__weight-values-label" htmlFor={`${idPrefix}-wv`}>
						{t(keys.calcBuilderWeightValues)}
					</label>
					<ReactSelect
						className="fb-calc-operand__weight-values"
						inputId={`${idPrefix}-wv`}
						options={weightValuesOptions}
						value={weightValuesOptions.find(
							(option) =>
								option.value ===
								(operand.source !== undefined ? sourceOptionValue(operand.source) : 'manual')
						)}
						isClearable={false}
						disabled={readOnly}
						onChange={(selected) => {
							const chosen = singleOption(selected)
							if (!chosen) {
								return
							}
							const sourceKey = sourceKeyOf(String(chosen.value))
							if (sourceKey === undefined) {
								if (operand.source !== undefined) {
									// Back to Manual: drop the source, keep any inline weights (they were
									// preserved untouched while sourced) so the author's numbers return.
									onChange({
										kind: 'weight',
										field: operand.field,
										weights: operand.weights ?? {},
									})
								}
								return
							}
							if (sourceKey !== operand.source) {
								onChange({ ...operand, source: sourceKey })
							}
						}}
					/>
				</div>
			) : null}
			{operand.kind === 'weight' && operand.source !== undefined ? (
				<p className="fb-calc-hint">{t(keys.calcBuilderWeightsFromSource)}</p>
			) : null}
			{operand.kind === 'weight' && operand.source === undefined && choice ? (
				<div className="fb-calc-operand__weights">
					{choice.options.map((option) => (
						<div key={option.value} className="fb-calc-operand__weight-row">
							<label
								className="fb-calc-operand__weight-label"
								htmlFor={`${idPrefix}-weight-${option.value}`}
							>
								{option.label}
							</label>
							<NumberInput
								className="fb-calc-operand__weight"
								id={`${idPrefix}-weight-${option.value}`}
								disabled={readOnly}
								value={operand.weights?.[option.value]}
								onCommit={(value) =>
									onChange({
										...operand,
										weights: { ...(operand.weights ?? {}), [option.value]: value },
									})
								}
							/>
						</div>
					))}
				</div>
			) : null}
		</div>
	)
}

type ChainEditorProps = {
	chain: CalcChain
	onChange: (next: CalcChain) => void
	/** Root only: called when the only row is removed, clearing the expression back to Start with. */
	onEmptied?: () => void
	/**
	 * Honest-affordance rule: an X must actually remove. The root's only-row X clears the whole
	 * expression, so it stays; a nested chain's only row (fn arg, group) would merely reseed, so
	 * its X is not rendered at all.
	 */
	isRoot?: boolean
	ctx: BuilderCtx
	idPrefix: string
}

const ChainEditor = ({ chain, onChange, onEmptied, isRoot, ctx, idPrefix }: ChainEditorProps) => {
	const { t, readOnly } = ctx

	const removeRow = (row: number) => {
		if (row === 0) {
			const [promoted, ...rest] = chain.steps
			if (!promoted) {
				onEmptied?.()
				return
			}
			onChange({ ...chain, first: promoted.operand, steps: rest })
			return
		}
		onChange({ ...chain, steps: chain.steps.filter((_, i) => i !== row - 1) })
	}

	const rows: { op?: CalcOp; operand: CalcOperand }[] = [
		{ operand: chain.first },
		...chain.steps.map((step) => ({ op: step.op, operand: step.operand })),
	]

	return (
		<div className="fb-calc-chain">
			{rows.map((row, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and never reordered
				<div key={index} className={index > 0 ? 'fb-calc-row fb-calc-row--divided' : 'fb-calc-row'}>
					{index === 0 ? <div className="fb-calc-row__op-spacer" aria-hidden="true" /> : null}
					{index > 0 ? (
						<>
							<label className="fb-visually-hidden" htmlFor={`${idPrefix}-r${index}-op`}>
								{t(keys.calcBuilderMath)}
							</label>
							<ReactSelect
								className="fb-calc-row__op"
								inputId={`${idPrefix}-r${index}-op`}
								options={OP_OPTIONS}
								value={OP_OPTIONS.find((option) => option.value === row.op)}
								isClearable={false}
								disabled={readOnly}
								onChange={(selected) => {
									const chosen = singleOption(selected)
									if (chosen) {
										onChange({
											...chain,
											steps: chain.steps.map((step, i) =>
												i === index - 1 ? { ...step, op: chosen.value as CalcOp } : step
											),
										})
									}
								}}
							/>
						</>
					) : null}
					<div className="fb-calc-row__operand">
						<OperandCard
							operand={row.operand}
							onChange={(operand) =>
								index === 0
									? onChange({ ...chain, first: operand })
									: onChange({
											...chain,
											steps: chain.steps.map((step, i) =>
												i === index - 1 ? { ...step, operand } : step
											),
										})
							}
							ctx={ctx}
							idPrefix={`${idPrefix}-r${index}`}
						/>
					</div>
					{rows.length > 1 || isRoot ? (
						<div className="fb-calc-row__remove">
							<Button
								buttonStyle="icon-label"
								icon="x"
								aria-label={t(keys.calcBuilderRemove)}
								margin={false}
								disabled={readOnly}
								onClick={() => removeRow(index)}
							/>
						</div>
					) : null}
				</div>
			))}
			<div className="fb-calc-chain__add">
				<Button
					buttonStyle="icon-label"
					icon="plus"
					iconStyle="with-border"
					iconPosition="left"
					margin={false}
					disabled={readOnly}
					onClick={() =>
						onChange({
							...chain,
							steps: [...chain.steps, { op: '*', operand: seedOperand('ref') }],
						})
					}
				>
					{t(keys.calcBuilderAddStep)}
				</Button>
			</div>
		</div>
	)
}

/**
 * Visual editor for the calculation field's `expression` AST, presented as a left-to-right chain.
 * Storage shape is unchanged and `validateExpression` stays the server gate; the AST remains
 * authorable via the API.
 */
export const CalcExpressionBuilder = (props: CalcExpressionBuilderProps) => {
	const {
		customComponents: { Error: ErrorComponent, Label } = {},
		disabled,
		path,
		setValue,
		showError,
		value,
	} = useField<unknown>({ path: props.path })
	const { t, i18n } = useTranslation()
	const label = toStaticLabel(props.field?.label)
	const readOnly = props.readOnly === true || disabled === true

	const sources = useMemo(() => props.sources ?? [], [props.sources])
	// Mirrors the server-side allowed sets, so the builder accepts exactly the expressions
	// `buildValidateExpression` accepts (a sourced expression must not read as "stored invalid").
	const allowed = useMemo(
		() => ({
			sources: new Set(sources.map((source) => source.key)),
			functions: new Set(props.functions ?? []),
		}),
		[sources, props.functions]
	)
	const sourceLabelOf = (key: string): string => {
		const meta = sources.find((source) => source.key === key)
		return meta ? resolveSourceLabel(meta.label, i18n.language) : key
	}
	const scalarSourceOptions: ChoiceOption[] = sources
		.filter((source) => source.scalar)
		.map((source) => ({ label: sourceLabelOf(source.key), value: sourceOptionValue(source.key) }))
	const weightSourceOptions: ChoiceOption[] = sources
		.filter((source) => source.weights)
		.map((source) => ({ label: sourceLabelOf(source.key), value: sourceOptionValue(source.key) }))
	const customFnOptions: ChoiceOption[] = (props.functions ?? []).map((fn) => ({
		label: fn,
		value: fn,
	}))

	const expression = useMemo(() => normalizeCalc(value, allowed), [value, allowed])
	const chain = useMemo(() => (expression ? astToChain(expression) : undefined), [expression])
	const storedInvalid = expression === undefined && value != null && value !== ''

	// The expression path is `fields.<row>.expression`; that row is the calculation block being
	// edited, so it bounds which calculation siblings are referenceable (see siblingsFromData).
	// An unparseable path (never expected) offers every calculation rather than none.
	const selfIndex = useMemo(() => {
		const match = /^fields\.(\d+)\./.exec(path)
		return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
	}, [path])

	const siblingsJson = useFormFields(([fields]) =>
		JSON.stringify(siblingsFromData(reduceFieldsToValues(fields, true), selfIndex))
	)
	const siblings = useMemo(() => JSON.parse(siblingsJson) as Siblings, [siblingsJson])

	const startOptions: ChoiceOption[] = [
		{ label: t(keys.calcBuilderAnswer), value: 'ref' },
		{ label: t(keys.calcBuilderNumber), value: 'lit' },
		{ label: t(keys.calcBuilderWeights), value: 'weight' },
		{ label: t(keys.calcBuilderFunction), value: 'fn' },
	]
	const startDescriptions: { key: string; label: string; description: string }[] = [
		{
			key: 'ref',
			label: t(keys.calcBuilderAnswer),
			description: t(keys.calcBuilderFieldDescription),
		},
		{
			key: 'lit',
			label: t(keys.calcBuilderNumber),
			description: t(keys.calcBuilderNumberDescription),
		},
		{
			key: 'weight',
			label: t(keys.calcBuilderWeights),
			description: t(keys.calcBuilderWeightsDescription),
		},
		{
			key: 'fn',
			label: t(keys.calcBuilderFunction),
			description: t(keys.calcBuilderFunctionDescription),
		},
	]

	const commitChain = (next: CalcChain) => {
		if (!readOnly) {
			setValue(chainToAst(next))
		}
	}

	const clear = () => {
		if (!readOnly) {
			setValue(null)
		}
	}

	// An unfilled slot (blank ref) previews as "?" so a partial chain reads "Price × ?" instead of
	// trailing off; formatCalc itself stays pure.
	const labelOf = (field: string) => (field.trim() === '' ? '?' : (siblings.labels[field] ?? field))

	const idBase = `calc-${path.replace(/\./g, '__')}`
	const ctx: BuilderCtx = {
		t,
		siblings,
		readOnly,
		sourceLabelOf,
		scalarSourceOptions,
		weightSourceOptions,
		customFnOptions,
	}

	return (
		<div
			className={['field-type', 'fb-calc-builder', showError && 'error', readOnly && 'read-only']
				.filter(Boolean)
				.join(' ')}
			id={path ? `field-${path.replace(/\./g, '__')}` : undefined}
		>
			<RenderCustomComponent
				CustomComponent={Label}
				Fallback={<FieldLabel label={label} path={path} />}
			/>
			<div className="field-type__wrap">
				<RenderCustomComponent
					CustomComponent={ErrorComponent}
					Fallback={<FieldError path={path} showError={showError} />}
				/>
				{chain ? (
					<>
						<ChainEditor
							chain={chain}
							onChange={commitChain}
							onEmptied={clear}
							isRoot
							ctx={ctx}
							idPrefix={idBase}
						/>
						<div className="fb-calc-finish">
							<label
								className="fb-calc-finish__label"
								htmlFor={`${idBase}-finish`}
								title={t(keys.calcBuilderThenApply)}
							>
								{t(keys.calcBuilderThenApply)}
							</label>
							<ReactSelect
								className="fb-calc-finish__select"
								inputId={`${idBase}-finish`}
								options={UNARY_OPTIONS}
								value={UNARY_OPTIONS.find((option) => option.value === chain.finish)}
								isClearable={!readOnly}
								disabled={readOnly}
								onChange={(selected) => {
									const chosen = singleOption(selected)
									commitChain({
										...chain,
										finish: chosen ? (chosen.value as CalcFn) : undefined,
									})
								}}
							/>
						</div>
					</>
				) : (
					<div className="fb-calc-builder__empty">
						{storedInvalid ? (
							<p className="fb-calc-builder__warning">{t(keys.calcBuilderStoredInvalid)}</p>
						) : null}
						<p className="fb-calc-builder__hint">{t(keys.calcBuilderAddExpression)}</p>
						<label className="fb-visually-hidden" htmlFor={`${idBase}-seed`}>
							{t(keys.calcBuilderStartWith)}
						</label>
						<ReactSelect
							className="fb-calc-builder__seed"
							inputId={`${idBase}-seed`}
							options={
								withSourceGroup(
									startOptions,
									scalarSourceOptions,
									t(keys.calcBuilderSourcesGroup)
								) as ReactSelectOption[]
							}
							disabled={readOnly}
							placeholder={t(keys.calcBuilderStartWith)}
							onChange={(selected) => {
								const chosen = singleOption(selected)
								if (!chosen || readOnly) {
									return
								}
								const sourceKey = sourceKeyOf(String(chosen.value))
								setValue(
									sourceKey !== undefined
										? { type: 'source', source: sourceKey }
										: seedAst(chosen.value as StartKind)
								)
							}}
						/>
						<ul className="fb-calc-builder__kinds">
							{startDescriptions.map((entry) => (
								<li key={entry.key}>
									<span className="fb-calc-builder__kind-label">{entry.label}</span>{' '}
									{entry.description}
								</li>
							))}
						</ul>
					</div>
				)}
				<p className="fb-calc-builder__preview" aria-live="polite">
					{expression ? formatCalc(expression, labelOf, sourceLabelOf) : ''}
				</p>
			</div>
		</div>
	)
}
