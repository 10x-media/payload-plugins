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
import { ConditionBuilder } from './ConditionBuilder'
import type { FieldRow } from './synthesizeClientField'
import { toStaticLabel } from './toStaticLabel'

export type FlowBuilderProps = {
	path?: string
	field?: { label?: unknown }
	label?: unknown
	conditionTypes: Record<string, ConditionFieldType>
}

const extractFieldNames = (data: Record<string, unknown>): string[] => {
	const rows = Array.isArray(data.fields) ? (data.fields as FieldRow[]) : []
	return rows
		.map((row) => (typeof row.name === 'string' ? row.name.trim() : null))
		.filter((name): name is string => name !== null && name.length > 0)
}

type TransitionRowProps = {
	transition: FlowTransition
	stepIds: string[]
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
	stepIds,
	conditionTypes,
	isFirst,
	isLast,
	onChange,
	onRemove,
	onMoveUp,
	onMoveDown,
}: TransitionRowProps) => {
	const toOptions: ReactSelectOption[] = stepIds.map((id) => ({ label: id, value: id }))

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
						options={toOptions}
						value={toOptions.find((o) => o.value === transition.to) ?? undefined}
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
	otherStepIds: string[]
	fieldNames: string[]
	conditionTypes: Record<string, ConditionFieldType>
	isExpanded: boolean
	onToggle: () => void
	onChange: (next: FlowStep) => void
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
	otherStepIds,
	fieldNames,
	conditionTypes,
	isExpanded,
	onToggle,
	onChange,
	onRemove,
	onMoveUp,
	onMoveDown,
	onAddAbove,
	onAddBelow,
}: StepCardProps) => {
	const nextOptions: ReactSelectOption[] = [
		{ label: '— terminal —', value: '' },
		...otherStepIds.map((id) => ({ label: id, value: id })),
	]

	const transitions = step.transitions ?? []

	// Stable per-transition keys, mirroring the step-level scheme so transition reorder/remove
	// reconciles by identity rather than array position.
	const tKeysRef = useRef<string[]>([])
	if (tKeysRef.current.length !== transitions.length) {
		tKeysRef.current = transitions.map((_, i) => tKeysRef.current[i] ?? crypto.randomUUID())
	}
	const tKeys = tKeysRef.current

	const addTransition = () => {
		const firstOtherStep = otherStepIds[0]
		if (!firstOtherStep) return
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
		const next = (chosen?.value as string | undefined) || undefined
		onChange({ ...step, next })
	}

	const stepHeader = (
		<div className="fb-flow-step__header-content">
			<span className="fb-flow-step__index">Step {stepIndex + 1}</span>
			<span className="fb-flow-step__id-preview">
				{step.id.length > 0 ? step.id : <em>no id</em>}
			</span>
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
					path={`fb-flow-step-${stepKey}-id`}
					label="Step ID"
					value={step.id}
					placeholder="e.g. intro"
					onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...step, id: e.target.value })}
				/>

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
					{fieldNames.length === 0 ? (
						<p className="fb-flow-step__hint">No fields defined on the form yet.</p>
					) : (
						<div className="fb-flow-step__field-picker">
							{fieldNames.map((name) => (
								<CheckboxInput
									key={name}
									label={name}
									checked={step.fields.includes(name)}
									onToggle={(e) => {
										const fields = e.target.checked
											? [...step.fields, name]
											: step.fields.filter((f) => f !== name)
										onChange({ ...step, fields })
									}}
								/>
							))}
						</div>
					)}
				</div>

				<div className="fb-flow-step__row">
					<FieldLabel label="Default next" />
					<ReactSelect
						options={nextOptions}
						value={
							step.next
								? (nextOptions.find((o) => o.value === step.next) ?? undefined)
								: (nextOptions[0] ?? undefined)
						}
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
								stepIds={otherStepIds}
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
	const label = toStaticLabel(props.field?.label ?? props.label)
	const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())

	const fieldNamesJson = useFormFields(([fields]) =>
		JSON.stringify(extractFieldNames(reduceFieldsToValues(fields, true) as Record<string, unknown>))
	)
	const fieldNames = useMemo(() => JSON.parse(fieldNamesJson) as string[], [fieldNamesJson])

	const steps = value?.steps ?? []
	const allStepIds = steps.map((s) => s.id).filter((id) => id.length > 0)

	// Stable per-step keys, decoupled from the user-editable step.id. Reorder/insert/remove
	// reconcile by identity so the focused Step ID input and each step's expand state stay with
	// their step instead of jumping to whichever step now sits at that array position.
	const keysRef = useRef<string[]>([])
	if (keysRef.current.length !== steps.length) {
		keysRef.current = steps.map((_, i) => keysRef.current[i] ?? crypto.randomUUID())
	}
	const keys = keysRef.current

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
		const nextKeys = [...keys]
		nextKeys.splice(at, 0, key)
		emit(nextSteps, nextKeys)
		setExpandedKeys((prev) => new Set(prev).add(key))
	}

	const addStep = () => insertStep(steps.length)

	const updateStep = (index: number, next: FlowStep) => {
		emit(
			steps.map((s, i) => (i === index ? next : s)),
			keys
		)
	}

	const removeStep = (index: number) => {
		const removedKey = keys[index]
		emit(
			steps.filter((_, i) => i !== index),
			keys.filter((_, i) => i !== index)
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
		const nextKeys = [...keys]
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
			{steps.length === 0 ? (
				<p className="fb-flow-builder__hint">
					No steps defined. Add at least two steps to enable multi-page flow routing.
				</p>
			) : (
				<div className="fb-flow-builder__steps">
					{steps.map((step, index) => {
						const key = keys[index]
						if (key === undefined) return null
						const otherStepIds = allStepIds.filter((id) => id !== step.id)
						return (
							<StepCard
								key={key}
								stepKey={key}
								step={step}
								stepIndex={index}
								stepCount={steps.length}
								otherStepIds={otherStepIds}
								fieldNames={fieldNames}
								conditionTypes={props.conditionTypes}
								isExpanded={expandedKeys.has(key)}
								onToggle={() => toggleExpanded(key)}
								onChange={(next) => updateStep(index, next)}
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
