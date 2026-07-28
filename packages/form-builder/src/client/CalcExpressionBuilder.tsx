'use client'

import {
	Button,
	FieldDescription,
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
import { CALC_FNS, CALC_OPS, type CalcExpression } from '../calc/types'
import { keys, type TranslationKey } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import type { FieldRow } from './synthesizeClientField'
import { toStaticLabel } from './toStaticLabel'
import './admin.css'

export type CalcExpressionBuilderProps = {
	path?: string
	field?: { label?: unknown; admin?: { description?: unknown } }
	readOnly?: boolean
	/** Field description as a translation key; `admin.description` functions are dropped from client fields. */
	descriptionKey?: TranslationKey
}

/** Node kinds offered by the picker. `neg` stays authorable via JSON only; an existing `neg` still renders. */
type NodeKind = 'ref' | 'lit' | 'op' | 'fn' | 'weight'

type ChildSlot = 'left' | 'right' | 'operand' | `arg:${number}`

type ChoiceOption = { label: string; value: string }
type ChoiceSibling = { name: string; label: string; options: ChoiceOption[] }
type Siblings = {
	numeric: ChoiceOption[]
	choices: ChoiceSibling[]
	labels: Record<string, string>
}

const seedNode = (kind: NodeKind): CalcExpression => {
	switch (kind) {
		case 'ref':
			return { type: 'ref', field: '' }
		case 'lit':
			return { type: 'lit', value: 0 }
		case 'op':
			return {
				type: 'op',
				op: '+',
				left: { type: 'lit', value: 0 },
				right: { type: 'lit', value: 0 },
			}
		case 'fn':
			return { type: 'fn', fn: 'round', args: [{ type: 'lit', value: 0 }] }
		case 'weight':
			return { type: 'weight', field: '', weights: {} }
	}
}

/**
 * Kind switches that can contain the current node promote it (Math takes it as the left operand,
 * Function as the first argument) so switching never silently destroys a built subtree; the leaf
 * kinds have no containment relationship and replace destructively.
 */
const convertNode = (current: CalcExpression, kind: NodeKind): CalcExpression => {
	switch (kind) {
		case 'op':
			return { type: 'op', op: '+', left: current, right: { type: 'lit', value: 0 } }
		case 'fn':
			return { type: 'fn', fn: 'round', args: [current] }
		default:
			return seedNode(kind)
	}
}

/**
 * Immutably replaces the node at `path` (a walk of child slots from the root), spreading every
 * ancestor on the way down so React re-renders exactly the edited branch and `setValue` always
 * receives a fresh tree. A slot that does not match the node shape returns the node unchanged.
 */
const replaceAt = (
	root: CalcExpression,
	path: readonly ChildSlot[],
	next: CalcExpression
): CalcExpression => {
	const slot = path[0]
	if (slot === undefined) {
		return next
	}
	const rest = path.slice(1)
	if (slot === 'left' && root.type === 'op') {
		return { ...root, left: replaceAt(root.left, rest, next) }
	}
	if (slot === 'right' && root.type === 'op') {
		return { ...root, right: replaceAt(root.right, rest, next) }
	}
	if (slot === 'operand' && root.type === 'neg') {
		return { ...root, operand: replaceAt(root.operand, rest, next) }
	}
	if (slot.startsWith('arg:') && root.type === 'fn') {
		const index = Number(slot.slice(4))
		return {
			...root,
			args: root.args.map((arg, i) => (i === index ? replaceAt(arg, rest, next) : arg)),
		}
	}
	return root
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

const sameExpression = (a: CalcExpression | undefined, b: CalcExpression | undefined): boolean =>
	JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

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
 * an invalid draft reverts to the committed value on blur, and an external value change (kind
 * switch, JSON apply) resyncs the draft.
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
	kindOptions: ChoiceOption[]
	siblings: Siblings
	readOnly: boolean
	idBase: string
	commit: (path: ChildSlot[], next: CalcExpression) => void
}

const OP_OPTIONS: ChoiceOption[] = CALC_OPS.map((op) => ({ label: op, value: op }))
const FN_OPTIONS: ChoiceOption[] = CALC_FNS.map((fn) => ({ label: fn, value: fn }))

type NodeEditorProps = { node: CalcExpression; nodePath: ChildSlot[]; ctx: BuilderCtx }

const NodeEditor = ({ node, nodePath, ctx }: NodeEditorProps) => {
	const { t, commit, siblings, readOnly } = ctx
	const idPrefix = `${ctx.idBase}-${nodePath.map((slot) => slot.replace(':', '-')).join('-') || 'root'}`
	const kindOptions =
		node.type === 'neg'
			? [...ctx.kindOptions, { label: t(keys.calcBuilderNegate), value: 'neg' }]
			: ctx.kindOptions
	const choice =
		node.type === 'weight' ? siblings.choices.find((c) => c.name === node.field) : undefined
	const refOptions = node.type === 'ref' ? withStored(siblings.numeric, node.field) : []
	const choiceOptions =
		node.type === 'weight'
			? withStored(
					siblings.choices.map((c) => ({ label: c.label, value: c.name })),
					node.field
				)
			: []
	return (
		<div className="fb-calc-node">
			<div className="fb-calc-node__header">
				<label className="fb-visually-hidden" htmlFor={`${idPrefix}-kind`}>
					{t(keys.calcBuilderKind)}
				</label>
				<ReactSelect
					className="fb-calc-node__kind"
					inputId={`${idPrefix}-kind`}
					options={kindOptions}
					value={kindOptions.find((option) => option.value === node.type)}
					isClearable={false}
					disabled={readOnly}
					onChange={(selected) => {
						const chosen = singleOption(selected)
						if (chosen && chosen.value !== node.type) {
							commit(nodePath, convertNode(node, chosen.value as NodeKind))
						}
					}}
				/>
				{node.type === 'op' ? (
					<>
						<label className="fb-visually-hidden" htmlFor={`${idPrefix}-op`}>
							{t(keys.calcBuilderMath)}
						</label>
						<ReactSelect
							className="fb-calc-node__op"
							inputId={`${idPrefix}-op`}
							options={OP_OPTIONS}
							value={OP_OPTIONS.find((option) => option.value === node.op)}
							isClearable={false}
							disabled={readOnly}
							onChange={(selected) => {
								const chosen = singleOption(selected)
								if (chosen) {
									commit(nodePath, { ...node, op: chosen.value as typeof node.op })
								}
							}}
						/>
					</>
				) : null}
				{node.type === 'fn' ? (
					<>
						<label className="fb-visually-hidden" htmlFor={`${idPrefix}-fn`}>
							{t(keys.calcBuilderFunction)}
						</label>
						<ReactSelect
							className="fb-calc-node__fn"
							inputId={`${idPrefix}-fn`}
							options={FN_OPTIONS}
							value={FN_OPTIONS.find((option) => option.value === node.fn)}
							isClearable={false}
							disabled={readOnly}
							onChange={(selected) => {
								const chosen = singleOption(selected)
								if (chosen) {
									commit(nodePath, { ...node, fn: chosen.value as typeof node.fn })
								}
							}}
						/>
					</>
				) : null}
				{node.type === 'ref' ? (
					refOptions.length === 0 ? (
						<p className="fb-calc-node__hint">{t(keys.calcBuilderNoNumericFields)}</p>
					) : (
						<>
							<label className="fb-visually-hidden" htmlFor={`${idPrefix}-ref`}>
								{t(keys.calcBuilderPickField)}
							</label>
							<ReactSelect
								className="fb-calc-node__ref"
								inputId={`${idPrefix}-ref`}
								options={refOptions}
								value={refOptions.find((option) => option.value === node.field)}
								isClearable={false}
								disabled={readOnly}
								placeholder={t(keys.calcBuilderPickField)}
								onChange={(selected) => {
									const chosen = singleOption(selected)
									commit(nodePath, { type: 'ref', field: chosen ? String(chosen.value) : '' })
								}}
							/>
						</>
					)
				) : null}
				{node.type === 'lit' ? (
					<NumberInput
						className="fb-calc-node__number"
						id={`${idPrefix}-number`}
						aria-label={t(keys.calcBuilderNumber)}
						disabled={readOnly}
						value={node.value}
						onCommit={(value) => commit(nodePath, { type: 'lit', value })}
					/>
				) : null}
				{node.type === 'weight' ? (
					choiceOptions.length === 0 ? (
						<p className="fb-calc-node__hint">{t(keys.calcBuilderNoChoiceFields)}</p>
					) : (
						<>
							<label className="fb-visually-hidden" htmlFor={`${idPrefix}-weight-field`}>
								{t(keys.calcBuilderPickField)}
							</label>
							<ReactSelect
								className="fb-calc-node__weight-field"
								inputId={`${idPrefix}-weight-field`}
								options={choiceOptions}
								value={choiceOptions.find((option) => option.value === node.field)}
								isClearable={false}
								disabled={readOnly}
								placeholder={t(keys.calcBuilderPickField)}
								onChange={(selected) => {
									const chosen = singleOption(selected)
									const field = chosen ? String(chosen.value) : ''
									if (field !== node.field) {
										commit(nodePath, { type: 'weight', field, weights: {} })
									}
								}}
							/>
						</>
					)
				) : null}
			</div>
			{node.type === 'op' ? (
				<div className="fb-calc-node__children">
					<NodeEditor node={node.left} nodePath={[...nodePath, 'left']} ctx={ctx} />
					<NodeEditor node={node.right} nodePath={[...nodePath, 'right']} ctx={ctx} />
				</div>
			) : null}
			{node.type === 'neg' ? (
				<div className="fb-calc-node__children">
					<NodeEditor node={node.operand} nodePath={[...nodePath, 'operand']} ctx={ctx} />
				</div>
			) : null}
			{node.type === 'fn' ? (
				<div className="fb-calc-node__children">
					{node.args.map((arg, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: args are positional and never reordered
						<div key={index} className="fb-calc-node__arg">
							<div className="fb-calc-node__arg-editor">
								<NodeEditor node={arg} nodePath={[...nodePath, `arg:${index}`]} ctx={ctx} />
							</div>
							{node.args.length > 1 ? (
								<div className="fb-calc-node__arg-remove">
									<Button
										buttonStyle="icon-label"
										icon="x"
										aria-label={t(keys.calcBuilderRemove)}
										margin={false}
										disabled={readOnly}
										onClick={() =>
											commit(nodePath, {
												...node,
												args: node.args.filter((_, i) => i !== index),
											})
										}
									/>
								</div>
							) : null}
						</div>
					))}
					<div className="fb-calc-node__add">
						<Button
							buttonStyle="icon-label"
							icon="plus"
							iconStyle="with-border"
							iconPosition="left"
							margin={false}
							disabled={readOnly}
							onClick={() => commit(nodePath, { ...node, args: [...node.args, seedNode('lit')] })}
						>
							{t(keys.calcBuilderAddArgument)}
						</Button>
					</div>
				</div>
			) : null}
			{node.type === 'weight' && choice ? (
				<div className="fb-calc-node__weights">
					{choice.options.map((option) => (
						<div key={option.value} className="fb-calc-node__weight-row">
							<label
								className="fb-calc-node__weight-label"
								htmlFor={`${idPrefix}-weight-${option.value}`}
							>
								{option.label}
							</label>
							<NumberInput
								className="fb-calc-node__weight"
								id={`${idPrefix}-weight-${option.value}`}
								disabled={readOnly}
								value={node.weights[option.value]}
								onCommit={(value) =>
									commit(nodePath, {
										...node,
										weights: { ...node.weights, [option.value]: value },
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

/**
 * Visual editor for the calculation field's `expression` AST. Edits the stored `CalcExpression`
 * tree in place (storage shape unchanged; `validateExpression` stays the server gate) with an
 * "Edit as JSON" escape hatch that round-trips through `normalizeCalc`.
 */
export const CalcExpressionBuilder = (props: CalcExpressionBuilderProps) => {
	const {
		customComponents: { Description, Error: ErrorComponent, Label } = {},
		disabled,
		path,
		setValue,
		showError,
		value,
	} = useField<unknown>({ path: props.path })
	const { t } = useTranslation()
	const label = toStaticLabel(props.field?.label)
	const description = props.descriptionKey
		? t(props.descriptionKey)
		: toStaticLabel(props.field?.admin?.description)
	const readOnly = props.readOnly === true || disabled === true

	const expression = useMemo(() => normalizeCalc(value), [value])

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

	const [jsonMode, setJsonMode] = useState(false)
	const [jsonDraft, setJsonDraft] = useState('')
	const [jsonError, setJsonError] = useState(false)

	const kindOptions: ChoiceOption[] = [
		{ label: t(keys.calcBuilderAnswer), value: 'ref' },
		{ label: t(keys.calcBuilderNumber), value: 'lit' },
		{ label: t(keys.calcBuilderMath), value: 'op' },
		{ label: t(keys.calcBuilderFunction), value: 'fn' },
		{ label: t(keys.calcBuilderWeights), value: 'weight' },
	]

	const commit = (nodePath: ChildSlot[], next: CalcExpression) => {
		if (readOnly) {
			return
		}
		setValue(expression ? replaceAt(expression, nodePath, next) : next)
	}

	const labelOf = (field: string) => siblings.labels[field] ?? field

	/** `null` is a valid JSON parse, so failure needs a flag rather than a sentinel value. */
	const parseDraft = (text: string): { ok: boolean; parsed: unknown } => {
		try {
			return { ok: true, parsed: JSON.parse(text) }
		} catch {
			return { ok: false, parsed: undefined }
		}
	}

	// Live-commits the draft whenever it is a well-formed expression, so a JSON edit is never lost
	// when the document is saved without leaving JSON mode; the toggle stays the final apply gate.
	const handleJsonChange = (text: string) => {
		setJsonDraft(text)
		const { ok, parsed } = parseDraft(text)
		if (!ok) {
			setJsonError(true)
			return
		}
		if (parsed === null) {
			setJsonError(false)
			return
		}
		const normalized = normalizeCalc(parsed)
		if (!normalized) {
			setJsonError(true)
			return
		}
		setJsonError(false)
		if (!sameExpression(normalized, expression)) {
			setValue(normalized)
		}
	}

	const toggleJson = () => {
		if (!jsonMode) {
			// A stored value that fails normalization (legacy/foreign data) seeds the draft raw, so
			// opening JSON mode never silently clobbers it.
			const source = expression ?? (value === undefined || value === '' ? null : value)
			setJsonDraft(JSON.stringify(source, null, 2))
			setJsonError(false)
			setJsonMode(true)
			return
		}
		const { ok, parsed } = parseDraft(jsonDraft)
		if (!ok) {
			setJsonError(true)
			return
		}
		// An explicit null clears the expression, matching the server gate (unset is valid).
		if (parsed === null) {
			if (expression !== undefined || (value != null && value !== '')) {
				setValue(null)
			}
			setJsonMode(false)
			return
		}
		const normalized = normalizeCalc(parsed)
		if (!normalized) {
			setJsonError(true)
			return
		}
		if (!sameExpression(normalized, expression)) {
			setValue(normalized)
		}
		setJsonMode(false)
	}

	const idBase = `calc-${path.replace(/\./g, '__')}`
	const ctx: BuilderCtx = { t, kindOptions, siblings, readOnly, idBase, commit }

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
				{jsonMode ? (
					<>
						<textarea
							className="fb-calc-builder__json-input"
							aria-label={t(keys.calcBuilderJsonMode)}
							value={jsonDraft}
							rows={10}
							disabled={readOnly}
							onChange={(event) => handleJsonChange(event.target.value)}
						/>
						{jsonError ? (
							<p className="fb-calc-builder__json-error" role="alert">
								{t(keys.calcBuilderJsonInvalid)}
							</p>
						) : null}
					</>
				) : expression ? (
					<NodeEditor node={expression} nodePath={[]} ctx={ctx} />
				) : (
					<div className="fb-calc-builder__empty">
						<label className="fb-calc-builder__hint" htmlFor={`${idBase}-seed`}>
							{t(keys.calcBuilderAddExpression)}
						</label>
						<ReactSelect
							className="fb-calc-builder__seed"
							inputId={`${idBase}-seed`}
							options={kindOptions}
							disabled={readOnly}
							placeholder={t(keys.calcBuilderAddExpression)}
							onChange={(selected) => {
								const chosen = singleOption(selected)
								if (chosen && !readOnly) {
									setValue(seedNode(chosen.value as NodeKind))
								}
							}}
						/>
					</div>
				)}
				<p className="fb-calc-builder__preview" aria-live="polite">
					{expression ? formatCalc(expression, labelOf) : ''}
				</p>
				<div className="fb-calc-builder__actions">
					<Button
						buttonStyle="pill"
						size="small"
						margin={false}
						disabled={readOnly}
						onClick={toggleJson}
					>
						{jsonMode ? t(keys.calcBuilderVisualMode) : t(keys.calcBuilderJsonMode)}
					</Button>
				</div>
			</div>
			<RenderCustomComponent
				CustomComponent={Description}
				Fallback={<FieldDescription description={description} path={path} />}
			/>
		</div>
	)
}
