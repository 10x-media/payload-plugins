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
import { useMemo, useState } from 'react'
import type { ConditionFieldType } from '../conditions/fieldTypes'
import type { FlowStep, FlowTransition, FormFlow } from '../flow/types'
import { ConditionBuilder } from './ConditionBuilder'
import type { FieldRow } from './synthesizeClientField'

export type FlowBuilderProps = {
	path?: string
	field?: { label?: unknown }
	label?: unknown
	conditionTypes: Record<string, ConditionFieldType>
}

const toStaticLabel = (label: unknown): string | Record<string, string> | undefined => {
	if (typeof label === 'string') return label
	if (label && typeof label === 'object') return label as Record<string, string>
	return undefined
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

	const addTransition = () => {
		const firstOtherStep = otherStepIds[0]
		if (!firstOtherStep) return
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
		const updated = transitions.filter((_, i) => i !== index)
		onChange({ ...step, transitions: updated.length > 0 ? updated : undefined })
	}

	const moveTransition = (from: number, to: number) => {
		const updated = [...transitions]
		const [item] = updated.splice(from, 1)
		if (item !== undefined) updated.splice(to, 0, item)
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
					path={`fb-flow-step-${stepIndex}-id`}
					label="Step ID"
					value={step.id}
					placeholder="e.g. intro"
					onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...step, id: e.target.value })}
				/>

				<TextInput
					path={`fb-flow-step-${stepIndex}-title`}
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
					{transitions.map((transition, tIndex) => (
						<TransitionRow
							key={tIndex}
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
					))}
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
	const [expandedIndices, setExpandedIndices] = useState<Set<number>>(new Set())

	const fieldNamesJson = useFormFields(([fields]) =>
		JSON.stringify(extractFieldNames(reduceFieldsToValues(fields, true) as Record<string, unknown>))
	)
	const fieldNames = useMemo(() => JSON.parse(fieldNamesJson) as string[], [fieldNamesJson])

	const steps = value?.steps ?? []
	const allStepIds = steps.map((s) => s.id).filter((id) => id.length > 0)

	const toggleExpanded = (index: number) => {
		setExpandedIndices((prev) => {
			const next = new Set(prev)
			if (next.has(index)) next.delete(index)
			else next.add(index)
			return next
		})
	}

	const emit = (nextSteps: FlowStep[]) => {
		setValue({ steps: nextSteps } as FormFlow)
	}

	const insertStep = (at: number) => {
		const next = [...steps]
		next.splice(at, 0, { id: crypto.randomUUID(), fields: [] })
		emit(next)
		setExpandedIndices((prev) => {
			const shifted = new Set<number>()
			for (const idx of prev) shifted.add(idx < at ? idx : idx + 1)
			shifted.add(at)
			return shifted
		})
	}

	const addStep = () => insertStep(steps.length)

	const updateStep = (index: number, next: FlowStep) => {
		emit(steps.map((s, i) => (i === index ? next : s)))
	}

	const removeStep = (index: number) => {
		emit(steps.filter((_, i) => i !== index))
		setExpandedIndices((prev) => {
			const next = new Set<number>()
			for (const idx of prev) {
				if (idx < index) next.add(idx)
				else if (idx > index) next.add(idx - 1)
			}
			return next
		})
	}

	const moveStep = (from: number, to: number) => {
		const next = [...steps]
		const [item] = next.splice(from, 1)
		if (item !== undefined) next.splice(to, 0, item)
		emit(next)
		setExpandedIndices((prev) => {
			const updated = new Set<number>()
			for (const idx of prev) {
				if (idx === from) updated.add(to)
				else if (from < to && idx > from && idx <= to) updated.add(idx - 1)
				else if (from > to && idx < from && idx >= to) updated.add(idx + 1)
				else updated.add(idx)
			}
			return updated
		})
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
						const otherStepIds = allStepIds.filter((id) => id !== step.id)
						return (
							<StepCard
								key={index}
								step={step}
								stepIndex={index}
								stepCount={steps.length}
								otherStepIds={otherStepIds}
								fieldNames={fieldNames}
								conditionTypes={props.conditionTypes}
								isExpanded={expandedIndices.has(index)}
								onToggle={() => toggleExpanded(index)}
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
