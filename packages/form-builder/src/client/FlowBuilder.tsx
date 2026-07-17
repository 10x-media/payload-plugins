'use client'

import {
	Button,
	CheckboxInput,
	Collapsible,
	FieldLabel,
	ReactSelect,
	type ReactSelectOption,
	TextInput,
	useField,
	useFormFields,
} from '@payloadcms/ui'
import { Popup, PopupList } from '@payloadcms/ui/elements/Popup'
import { MoreIcon } from '@payloadcms/ui/icons/More'
import { reduceFieldsToValues } from 'payload/shared'
import type { ChangeEvent } from 'react'
import { useMemo, useRef, useState } from 'react'
import type { ConditionFieldType } from '../conditions/fieldTypes'
import type { FlowStep, FlowTransition, FormFlow } from '../flow/types'
import { keys, type TranslationKey } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { resolveMessage } from '../validation/message'
import { ConditionBuilder } from './ConditionBuilder'
import {
	assignFieldToStep,
	type FlowFieldEntry,
	type FlowSelectOption,
	fieldHolders,
	flowFieldEntries,
	nextFromSelectValue,
	nextSelectOptions,
	nextToSelectValue,
	otherStepSelectOptions,
	removeFieldFromStep,
	removeStepCascade,
	stepLabel,
	stepSelectOptions,
	unassignedEntries,
} from './flowAuthoring'
import type { FieldRow } from './synthesizeClientField'
import { toStaticLabel } from './toStaticLabel'
import './admin.css'

export type FlowBuilderProps = {
	path?: string
	field?: { label?: unknown }
	label?: unknown
	conditionTypes: Record<string, ConditionFieldType>
	/** Bare (nameless) block slugs to their display label: an i18n key or a literal. */
	bareTypeLabels?: Record<string, string>
}

/** The row facets the flow builder keys and labels by, projected for a stable JSON identity. */
const extractFieldRows = (data: Record<string, unknown>): FieldRow[] => {
	const rows = Array.isArray(data.fields) ? (data.fields as FieldRow[]) : []
	return rows.map((row) => ({ blockType: row.blockType, name: row.name, id: row.id }))
}

type TransitionRowProps = {
	transition: FlowTransition
	stepOptions: FlowSelectOption[]
	conditionTypes: Record<string, ConditionFieldType>
	isFirst: boolean
	isLast: boolean
	onChange: (next: FlowTransition) => void
	onRemove: () => void
	onMoveUp: () => void
	onMoveDown: () => void
}

const TransitionRow = ({
	transition,
	stepOptions,
	conditionTypes,
	isFirst,
	isLast,
	onChange,
	onRemove,
	onMoveUp,
	onMoveDown,
}: TransitionRowProps) => {
	const handleGotoChange = (selected: ReactSelectOption | ReactSelectOption[]) => {
		const chosen = Array.isArray(selected) ? selected[0] : selected
		if (chosen) onChange({ ...transition, to: chosen.value as string })
	}

	return (
		<div className="fb-flow-transition">
			<div className="fb-flow-transition__header">
				<span className="fb-flow-transition__label">go to</span>
				<div className="fb-flow-transition__goto">
					<ReactSelect
						options={stepOptions}
						value={stepOptions.find((o) => o.value === transition.to) ?? undefined}
						placeholder="Select step…"
						isClearable={false}
						onChange={handleGotoChange}
					/>
				</div>
				<div className="fb-flow-transition__actions">
					<button
						type="button"
						className="fb-flow__move-btn"
						onClick={onMoveUp}
						disabled={isFirst}
						aria-label="Move transition up"
					>
						↑
					</button>
					<button
						type="button"
						className="fb-flow__move-btn"
						onClick={onMoveDown}
						disabled={isLast}
						aria-label="Move transition down"
					>
						↓
					</button>
					<Button
						buttonStyle="icon-label"
						icon="x"
						onClick={onRemove}
						margin={false}
						aria-label="Remove transition"
					/>
				</div>
			</div>
			<span className="fb-flow-transition__when-label">when</span>
			<div className="fb-flow-transition__condition">
				<ConditionBuilder
					value={transition.when}
					onChange={(when) => onChange({ ...transition, when })}
					conditionTypes={conditionTypes}
				/>
			</div>
		</div>
	)
}

type StepCardProps = {
	step: FlowStep
	stepKey: string
	stepIndex: number
	stepCount: number
	otherStepOptions: FlowSelectOption[]
	holders: Map<string, number>
	stepLabels: string[]
	entries: FlowFieldEntry[]
	conditionTypes: Record<string, ConditionFieldType>
	isExpanded: boolean
	onToggle: () => void
	onChange: (next: FlowStep) => void
	onToggleField: (key: string, checked: boolean) => void
	onRemove: () => void
	onMoveUp: () => void
	onMoveDown: () => void
	onAddAbove: () => void
	onAddBelow: () => void
}

const StepCard = ({
	step,
	stepKey,
	stepIndex,
	stepCount,
	otherStepOptions,
	holders,
	stepLabels,
	entries,
	conditionTypes,
	isExpanded,
	onToggle,
	onChange,
	onToggleField,
	onRemove,
	onMoveUp,
	onMoveDown,
	onAddAbove,
	onAddBelow,
}: StepCardProps) => {
	const { t } = useTranslation()

	const nextOptions = nextSelectOptions({
		sequentialLabel: t(keys.flowNextSequential),
		terminalLabel: t(keys.flowNextTerminal),
		otherSteps: otherStepOptions,
	})

	const transitions = step.transitions ?? []

	// Stable per-transition keys, mirroring the step-level scheme so transition reorder/remove
	// reconciles by identity rather than array position.
	const tKeysRef = useRef<string[]>([])
	if (tKeysRef.current.length !== transitions.length) {
		tKeysRef.current = transitions.map((_, i) => tKeysRef.current[i] ?? crypto.randomUUID())
	}
	const tKeys = tKeysRef.current

	const addTransition = () => {
		const firstOtherStep = otherStepOptions[0]?.value
		if (firstOtherStep === undefined) return
		tKeysRef.current = [...tKeys, crypto.randomUUID()]
		onChange({
			...step,
			transitions: [...transitions, { when: {}, to: firstOtherStep }],
		})
	}

	const updateTransition = (index: number, next: FlowTransition) => {
		const updated = [...transitions]
		updated[index] = next
		onChange({ ...step, transitions: updated })
	}

	const removeTransition = (index: number) => {
		tKeysRef.current = tKeys.filter((_, i) => i !== index)
		const updated = transitions.filter((_, i) => i !== index)
		onChange({ ...step, transitions: updated.length > 0 ? updated : undefined })
	}

	const moveTransition = (from: number, to: number) => {
		const updated = [...transitions]
		const [item] = updated.splice(from, 1)
		if (item !== undefined) updated.splice(to, 0, item)
		const nextKeys = [...tKeys]
		const [movedKey] = nextKeys.splice(from, 1)
		if (movedKey !== undefined) nextKeys.splice(to, 0, movedKey)
		tKeysRef.current = nextKeys
		onChange({ ...step, transitions: updated })
	}

	const handleNextChange = (selected: ReactSelectOption | ReactSelectOption[]) => {
		const chosen = Array.isArray(selected) ? selected[0] : selected
		if (chosen) onChange({ ...step, next: nextFromSelectValue(chosen.value as string) })
	}

	const title = step.title?.trim() ?? ''

	const stepHeader = (
		<div className="fb-flow-step__header-content">
			<span className="fb-flow-step__index">
				{resolveMessage(t(keys.flowStepFallbackTitle), { n: stepIndex + 1 })}
			</span>
			{title.length > 0 ? <span className="fb-flow-step__title">{title}</span> : null}
		</div>
	)

	return (
		<Collapsible
			header={stepHeader}
			actions={
				<Popup
					button={<MoreIcon />}
					buttonType="default"
					horizontalAlign="right"
					size="fit-content"
					verticalAlign="bottom"
				>
					<PopupList.ButtonGroup>
						<PopupList.Button onClick={onAddAbove}>Add above</PopupList.Button>
						<PopupList.Button onClick={onAddBelow}>Add below</PopupList.Button>
						<PopupList.Button onClick={onMoveUp} disabled={stepIndex === 0}>
							Move up
						</PopupList.Button>
						<PopupList.Button onClick={onMoveDown} disabled={stepIndex === stepCount - 1}>
							Move down
						</PopupList.Button>
						<PopupList.Button onClick={onRemove}>Remove</PopupList.Button>
					</PopupList.ButtonGroup>
				</Popup>
			}
			isCollapsed={!isExpanded}
			onToggle={() => onToggle()}
			className="fb-flow-step"
		>
			<div className="fb-flow-step__body">
				<TextInput
					path={`fb-flow-step-${stepKey}-title`}
					label="Title"
					value={step.title ?? ''}
					placeholder="Optional display title"
					onChange={(e: ChangeEvent<HTMLInputElement>) =>
						onChange({ ...step, title: e.target.value.length > 0 ? e.target.value : undefined })
					}
				/>

				<div className="fb-flow-step__row">
					<FieldLabel label="Fields" />
					{entries.length === 0 ? (
						<p className="fb-flow-step__hint">No fields defined on the form yet.</p>
					) : (
						<div className="fb-flow-step__field-picker">
							{entries.map((entry) => {
								const holder = holders.get(entry.key)
								const inOtherStep = holder !== undefined && holder !== stepIndex
								return (
									<div key={entry.key} className="fb-flow-step__field-option">
										<CheckboxInput
											label={entry.label}
											checked={step.fields.includes(entry.key) || inOtherStep}
											readOnly={inOtherStep}
											onToggle={(e) => {
												if (inOtherStep) return
												onToggleField(entry.key, e.target.checked)
											}}
										/>
										{inOtherStep ? (
											<span className="fb-flow-step__field-hint">
												{resolveMessage(t(keys.flowFieldInStep), {
													step: stepLabels[holder] ?? '',
												})}
											</span>
										) : null}
									</div>
								)
							})}
						</div>
					)}
				</div>

				<div className="fb-flow-step__row">
					<FieldLabel label="Default next" />
					<ReactSelect
						options={nextOptions}
						value={nextOptions.find((o) => o.value === nextToSelectValue(step.next)) ?? undefined}
						isClearable={false}
						onChange={handleNextChange}
					/>
				</div>

				<div className="fb-flow-step__transitions">
					<div className="fb-flow-step__transitions-header">
						<FieldLabel label="Conditional transitions" />
						<span className="fb-flow-step__hint">(first match wins)</span>
					</div>
					{transitions.map((transition, tIndex) => {
						const tKey = tKeys[tIndex]
						if (tKey === undefined) return null
						return (
							<TransitionRow
								key={tKey}
								transition={transition}
								stepOptions={otherStepOptions}
								conditionTypes={conditionTypes}
								isFirst={tIndex === 0}
								isLast={tIndex === transitions.length - 1}
								onChange={(next) => updateTransition(tIndex, next)}
								onRemove={() => removeTransition(tIndex)}
								onMoveUp={() => moveTransition(tIndex, tIndex - 1)}
								onMoveDown={() => moveTransition(tIndex, tIndex + 1)}
							/>
						)
					})}
					<Button
						buttonStyle="icon-label"
						icon="plus"
						iconStyle="with-border"
						iconPosition="left"
						onClick={addTransition}
						margin={false}
					>
						Add transition
					</Button>
				</div>
			</div>
		</Collapsible>
	)
}

export const FlowBuilder = (props: FlowBuilderProps) => {
	const { setValue, value } = useField<FormFlow | undefined>()
	const { t } = useTranslation()
	const label = toStaticLabel(props.field?.label ?? props.label)
	const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())

	const fieldRowsJson = useFormFields(([fields]) =>
		JSON.stringify(extractFieldRows(reduceFieldsToValues(fields, true) as Record<string, unknown>))
	)
	// Registry labels may be host-registered keys or literals; Payload's `t` returns unknown keys unchanged.
	const translatedBareLabels = useMemo(
		() =>
			Object.fromEntries(
				Object.entries(props.bareTypeLabels ?? {}).map(([type, label]) => [
					type,
					t(label as TranslationKey),
				])
			),
		[props.bareTypeLabels, t]
	)
	const entries = useMemo(
		() => flowFieldEntries(JSON.parse(fieldRowsJson) as FieldRow[], translatedBareLabels),
		[fieldRowsJson, translatedBareLabels]
	)

	const steps = value?.steps ?? []
	const fallbackTitle = t(keys.flowStepFallbackTitle)
	const stepLabels = steps.map((step, index) => stepLabel(step, index, fallbackTitle))
	const stepOptions = stepSelectOptions(steps, stepLabels)
	const holders = fieldHolders(steps)
	const unassigned = unassignedEntries(entries, steps)

	// Stable per-step React keys, independent of step ids. Reorder/insert/remove reconcile by
	// identity so focused inputs and each step's expand state stay with their step instead of
	// jumping to whichever step now sits at that array position.
	const keysRef = useRef<string[]>([])
	if (keysRef.current.length !== steps.length) {
		keysRef.current = steps.map((_, i) => keysRef.current[i] ?? crypto.randomUUID())
	}
	const stepKeys = keysRef.current

	const toggleExpanded = (key: string) => {
		setExpandedKeys((prev) => {
			const next = new Set(prev)
			if (next.has(key)) next.delete(key)
			else next.add(key)
			return next
		})
	}

	const emit = (nextSteps: FlowStep[], nextKeys: string[]) => {
		keysRef.current = nextKeys
		setValue({ steps: nextSteps } as FormFlow)
	}

	const insertStep = (at: number) => {
		const key = crypto.randomUUID()
		const nextSteps = [...steps]
		nextSteps.splice(at, 0, { id: crypto.randomUUID(), fields: [] })
		const nextKeys = [...stepKeys]
		nextKeys.splice(at, 0, key)
		emit(nextSteps, nextKeys)
		setExpandedKeys((prev) => new Set(prev).add(key))
	}

	const addStep = () => insertStep(steps.length)

	const updateStep = (index: number, next: FlowStep) => {
		emit(
			steps.map((s, i) => (i === index ? next : s)),
			stepKeys
		)
	}

	const toggleField = (stepIndex: number, key: string, checked: boolean) => {
		const nextSteps = checked
			? assignFieldToStep(steps, stepIndex, key)
			: removeFieldFromStep(steps, stepIndex, key)
		emit(nextSteps, stepKeys)
	}

	const assignUnassignedField = (key: string, stepId: string) => {
		const targetIndex = steps.findIndex((s) => s.id === stepId)
		if (targetIndex === -1) return
		emit(assignFieldToStep(steps, targetIndex, key), stepKeys)
	}

	const removeStep = (index: number) => {
		const removedKey = stepKeys[index]
		emit(
			removeStepCascade(steps, index),
			stepKeys.filter((_, i) => i !== index)
		)
		if (removedKey !== undefined) {
			setExpandedKeys((prev) => {
				const next = new Set(prev)
				next.delete(removedKey)
				return next
			})
		}
	}

	const moveStep = (from: number, to: number) => {
		const nextSteps = [...steps]
		const [movedStep] = nextSteps.splice(from, 1)
		if (movedStep === undefined) return
		nextSteps.splice(to, 0, movedStep)
		const nextKeys = [...stepKeys]
		const [movedKey] = nextKeys.splice(from, 1)
		if (movedKey !== undefined) nextKeys.splice(to, 0, movedKey)
		emit(nextSteps, nextKeys)
	}

	return (
		<div className="field-type fb-flow-builder">
			<div className="blocks-field__header">
				<div className="blocks-field__header-wrap">
					<h3>{typeof label === 'string' ? label : 'Flow'}</h3>
				</div>
			</div>
			<p className="fb-flow-builder__description">{t(keys.flowDescription)}</p>
			{steps.length === 0 ? (
				<p className="fb-flow-builder__hint">
					No steps defined. Add at least two steps to enable multi-page flow routing.
				</p>
			) : (
				<div className="fb-flow-builder__steps">
					{steps.map((step, index) => {
						const key = stepKeys[index]
						if (key === undefined) return null
						const otherStepOptions = otherStepSelectOptions(stepOptions, step.id)
						return (
							<StepCard
								key={key}
								stepKey={key}
								step={step}
								stepIndex={index}
								stepCount={steps.length}
								otherStepOptions={otherStepOptions}
								holders={holders}
								stepLabels={stepLabels}
								entries={entries}
								conditionTypes={props.conditionTypes}
								isExpanded={expandedKeys.has(key)}
								onToggle={() => toggleExpanded(key)}
								onChange={(next) => updateStep(index, next)}
								onToggleField={(fieldKey, checked) => toggleField(index, fieldKey, checked)}
								onRemove={() => removeStep(index)}
								onMoveUp={() => moveStep(index, index - 1)}
								onMoveDown={() => moveStep(index, index + 1)}
								onAddAbove={() => insertStep(index)}
								onAddBelow={() => insertStep(index + 1)}
							/>
						)
					})}
				</div>
			)}
			{steps.length > 0 && unassigned.length > 0 ? (
				<div className="fb-flow-unassigned">
					<FieldLabel label={t(keys.flowUnassigned)} />
					<div className="fb-flow-unassigned__rows">
						{unassigned.map((entry) => (
							<div key={entry.key} className="fb-flow-unassigned__row">
								<span className="fb-flow-unassigned__name">{entry.label}</span>
								<div className="fb-flow-unassigned__select">
									<ReactSelect
										options={stepOptions}
										placeholder={t(keys.flowAssignToStep)}
										isClearable={false}
										onChange={(selected: ReactSelectOption | ReactSelectOption[]) => {
											const chosen = Array.isArray(selected) ? selected[0] : selected
											if (chosen) assignUnassignedField(entry.key, chosen.value as string)
										}}
									/>
								</div>
							</div>
						))}
					</div>
				</div>
			) : null}
			<div className="fb-flow-builder__actions">
				<Button
					buttonStyle="icon-label"
					icon="plus"
					iconStyle="with-border"
					iconPosition="left"
					onClick={addStep}
					margin={false}
				>
					Add step
				</Button>
			</div>
		</div>
	)
}
