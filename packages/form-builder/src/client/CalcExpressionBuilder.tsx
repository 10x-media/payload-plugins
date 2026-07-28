'use client'

import {
	Button,
	FieldDescription,
	FieldLabel,
	ReactSelect,
	type ReactSelectOption,
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

const NUMERIC_TYPES = ['number', 'calculation']

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
		if (index !== selfIndex && typeof blockType === 'string' && NUMERIC_TYPES.includes(blockType)) {
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
	'aria-label': string
}

/**
 * Number input with a local draft so partial entries ("-", "1.") survive keystrokes; only finite
 * numbers commit, and an external value change (kind switch, JSON apply) resyncs the draft.
 */
const NumberInput = ({ value, onCommit, className, 'aria-label': ariaLabel }: NumberInputProps) => {
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
	commit: (path: ChildSlot[], next: CalcExpression) => void
}

const OP_OPTIONS: ChoiceOption[] = CALC_OPS.map((op) => ({ label: op, value: op }))
const FN_OPTIONS: ChoiceOption[] = CALC_FNS.map((fn) => ({ label: fn, value: fn }))

type NodeEditorProps = { node: CalcExpression; nodePath: ChildSlot[]; ctx: BuilderCtx }

const NodeEditor = ({ node, nodePath, ctx }: NodeEditorProps) => {
	const { t, commit, siblings } = ctx
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
				<ReactSelect
					className="fb-calc-node__kind"
					options={ctx.kindOptions}
					value={ctx.kindOptions.find((option) => option.value === node.type)}
					isClearable={false}
					onChange={(selected) => {
						const chosen = singleOption(selected)
						if (chosen && chosen.value !== node.type) {
							commit(nodePath, seedNode(chosen.value as NodeKind))
						}
					}}
				/>
				{node.type === 'op' ? (
					<ReactSelect
						className="fb-calc-node__op"
						options={OP_OPTIONS}
						value={OP_OPTIONS.find((option) => option.value === node.op)}
						isClearable={false}
						onChange={(selected) => {
							const chosen = singleOption(selected)
							if (chosen) {
								commit(nodePath, { ...node, op: chosen.value as typeof node.op })
							}
						}}
					/>
				) : null}
				{node.type === 'fn' ? (
					<ReactSelect
						className="fb-calc-node__fn"
						options={FN_OPTIONS}
						value={FN_OPTIONS.find((option) => option.value === node.fn)}
						isClearable={false}
						onChange={(selected) => {
							const chosen = singleOption(selected)
							if (chosen) {
								commit(nodePath, { ...node, fn: chosen.value as typeof node.fn })
							}
						}}
					/>
				) : null}
				{node.type === 'ref' ? (
					<ReactSelect
						className="fb-calc-node__ref"
						options={refOptions}
						value={refOptions.find((option) => option.value === node.field)}
						isClearable={false}
						placeholder={t(keys.calcBuilderPickField)}
						onChange={(selected) => {
							const chosen = singleOption(selected)
							commit(nodePath, { type: 'ref', field: chosen ? String(chosen.value) : '' })
						}}
					/>
				) : null}
				{node.type === 'lit' ? (
					<NumberInput
						className="fb-calc-node__number"
						aria-label={t(keys.calcBuilderNumber)}
						value={node.value}
						onCommit={(value) => commit(nodePath, { type: 'lit', value })}
					/>
				) : null}
				{node.type === 'weight' ? (
					<ReactSelect
						className="fb-calc-node__weight-field"
						options={choiceOptions}
						value={choiceOptions.find((option) => option.value === node.field)}
						isClearable={false}
						placeholder={t(keys.calcBuilderPickField)}
						onChange={(selected) => {
							const chosen = singleOption(selected)
							const field = chosen ? String(chosen.value) : ''
							if (field !== node.field) {
								commit(nodePath, { type: 'weight', field, weights: {} })
							}
						}}
					/>
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
							<span className="fb-calc-node__weight-label">{option.label}</span>
							<NumberInput
								className="fb-calc-node__weight"
								aria-label={option.label}
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
	const { path, setValue, value } = useField<unknown>({ path: props.path ?? '' })
	const { t } = useTranslation()
	const label = toStaticLabel(props.field?.label)
	const description = props.descriptionKey
		? t(props.descriptionKey)
		: toStaticLabel(props.field?.admin?.description)

	const expression = useMemo(() => normalizeCalc(value), [value])

	// The expression path is `fields.<row>.expression`; that row is the calculation block being
	// edited, so it is excluded from the answer picker (a self-reference could never resolve).
	const selfIndex = useMemo(() => {
		const match = /^fields\.(\d+)\./.exec(path)
		return match ? Number(match[1]) : -1
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

	const commit = (nodePath: ChildSlot[], next: CalcExpression) =>
		setValue(expression ? replaceAt(expression, nodePath, next) : next)

	const labelOf = (field: string) => siblings.labels[field] ?? field

	const toggleJson = () => {
		if (!jsonMode) {
			setJsonDraft(JSON.stringify(expression ?? null, null, 2))
			setJsonError(false)
			setJsonMode(true)
			return
		}
		let parsed: unknown
		try {
			parsed = JSON.parse(jsonDraft)
		} catch {
			setJsonError(true)
			return
		}
		// An explicit null clears the expression, matching the server gate (unset is valid).
		if (parsed === null) {
			setValue(null)
			setJsonMode(false)
			return
		}
		const normalized = normalizeCalc(parsed)
		if (!normalized) {
			setJsonError(true)
			return
		}
		setValue(normalized)
		setJsonMode(false)
	}

	const ctx: BuilderCtx = { t, kindOptions, siblings, commit }

	return (
		<div className="field-type fb-calc-builder">
			<FieldLabel label={label} path={path} />
			{jsonMode ? (
				<>
					<textarea
						className="fb-calc-builder__json-input"
						aria-label={t(keys.calcBuilderJsonMode)}
						value={jsonDraft}
						rows={10}
						onChange={(event) => {
							setJsonDraft(event.target.value)
							setJsonError(false)
						}}
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
					<p className="fb-calc-builder__hint">{t(keys.calcBuilderAddExpression)}</p>
					<ReactSelect
						className="fb-calc-builder__seed"
						options={kindOptions}
						placeholder={t(keys.calcBuilderAddExpression)}
						onChange={(selected) => {
							const chosen = singleOption(selected)
							if (chosen) {
								setValue(seedNode(chosen.value as NodeKind))
							}
						}}
					/>
				</div>
			)}
			{!jsonMode && expression ? (
				<p className="fb-calc-builder__preview" aria-live="polite">
					{formatCalc(expression, labelOf)}
				</p>
			) : null}
			<div className="fb-calc-builder__actions">
				<Button buttonStyle="pill" size="small" margin={false} onClick={toggleJson}>
					{jsonMode ? t(keys.calcBuilderVisualMode) : t(keys.calcBuilderJsonMode)}
				</Button>
			</div>
			<FieldDescription description={description} path={path} />
		</div>
	)
}
