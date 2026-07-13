'use client'

import {
	FieldShell,
	Form,
	type FormDocument,
	FormLayout,
	Input,
	type SelectOption,
	stepFieldNames,
	useField,
	useFormState,
	useFormStep,
} from '@10x-media/form-builder/react'
import { useCallback, useMemo } from 'react'

type WizardFormProps = {
	form: FormDocument
	[key: string]: unknown
}

const COLORS = {
	active: '#6C63FF',
	done: '#4CAF50',
	pending: '#E0E0E0',
	pendingText: '#999',
	white: '#fff',
	card: '#fff',
	cardShadow: '0 2px 12px rgba(0,0,0,0.06)',
	border: '#EBEAED',
	text: '#1A1A2E',
	muted: '#6B7280',
	danger: '#EF4444',
}

const StepIndicator = ({
	label,
	index,
	isActive,
	isDone,
}: {
	label: string
	index: number
	isActive: boolean
	isDone: boolean
}) => {
	const bg = isActive ? COLORS.active : isDone ? COLORS.done : COLORS.pending
	const color = isActive || isDone ? COLORS.white : COLORS.pendingText
	const size = isActive ? 36 : 32

	return (
		<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
			<div
				style={{
					width: size,
					height: size,
					borderRadius: '50%',
					background: bg,
					color,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					fontWeight: 700,
					fontSize: 14,
					flexShrink: 0,
					transition: 'all 0.25s ease',
					boxShadow: isActive ? '0 0 0 4px rgba(108,99,255,0.2)' : 'none',
				}}
			>
				{isDone ? '✓' : index + 1}
			</div>
			<span
				style={{
					fontSize: 13,
					fontWeight: isActive ? 600 : 400,
					color: isActive ? COLORS.text : isDone ? COLORS.text : COLORS.muted,
					transition: 'color 0.25s ease',
				}}
			>
				{label}
			</span>
		</div>
	)
}

const Connector = ({ active }: { active: boolean }) => (
	<div
		style={{
			width: 2,
			height: 20,
			background: active ? COLORS.active : COLORS.pending,
			marginLeft: 15,
			transition: 'background 0.25s ease',
		}}
	/>
)

const FieldRenderer = ({
	name,
	blockType,
	label,
	required,
	options,
}: {
	name: string
	blockType: string
	label?: string
	required?: boolean
	options?: SelectOption[]
}) => {
	const field = useField<string>(name)
	const id = `fb-field-${name}`
	const describedBy = `${id}-desc`

	const onInput = useCallback((val: string) => field.setValue(val), [field])

	const shell = {
		id,
		describedById: describedBy,
		errors: field.errors,
		label: `${label ?? name}${required ? ' *' : ''}`,
		required,
	}

	const inputStyle = {
		width: '100%',
		padding: '10px 14px',
		borderRadius: 8,
		border: `1.5px solid ${field.errors.length > 0 ? COLORS.danger : COLORS.border}`,
		fontSize: 15,
		outline: 'none',
		transition: 'border-color 0.2s',
		background: COLORS.white,
		boxSizing: 'border-box' as const,
	}

	switch (blockType) {
		case 'textarea':
			return (
				<FieldShell {...shell}>
					<textarea
						id={id}
						name={name}
						value={field.value ?? ''}
						onChange={(e) => onInput(e.target.value)}
						onBlur={field.onBlur}
						aria-describedby={describedBy}
						aria-invalid={field.errors.length > 0 || undefined}
						style={{ ...inputStyle, minHeight: 100, resize: 'vertical', fontFamily: 'inherit' }}
					/>
				</FieldShell>
			)
		case 'select':
			return (
				<FieldShell {...shell}>
					<select
						id={id}
						name={name}
						value={field.value ?? ''}
						onChange={(e) => field.setValue(e.target.value)}
						onBlur={field.onBlur}
						aria-describedby={describedBy}
						aria-invalid={field.errors.length > 0 || undefined}
						style={inputStyle}
					>
						<option value="">-- Select --</option>
						{(options ?? []).map((opt) => (
							<option key={opt.value} value={opt.value}>
								{opt.label}
							</option>
						))}
					</select>
				</FieldShell>
			)
		case 'checkbox':
			return (
				<FieldShell {...shell}>
					<label
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: 10,
							cursor: 'pointer',
							fontSize: 15,
						}}
					>
						<input
							id={id}
							type="checkbox"
							checked={field.value === 'true'}
							onChange={(e) => field.setValue(String(e.target.checked))}
							onBlur={field.onBlur}
							aria-describedby={describedBy}
							aria-invalid={field.errors.length > 0 || undefined}
							style={{ width: 18, height: 18, accentColor: COLORS.active }}
						/>
						{label ?? name}
					</label>
				</FieldShell>
			)
		case 'email':
			return (
				<FieldShell {...shell}>
					<Input
						id={id}
						name={name}
						type="email"
						value={field.value ?? ''}
						onChange={onInput}
						onBlur={field.onBlur}
						invalid={field.errors.length > 0}
						describedById={describedBy}
					/>
				</FieldShell>
			)
		case 'number':
			return (
				<FieldShell {...shell}>
					<Input
						id={id}
						name={name}
						type="number"
						value={field.value ?? ''}
						onChange={onInput}
						onBlur={field.onBlur}
						invalid={field.errors.length > 0}
						describedById={describedBy}
					/>
				</FieldShell>
			)
		default:
			return (
				<FieldShell {...shell}>
					<Input
						id={id}
						name={name}
						value={field.value ?? ''}
						onChange={onInput}
						onBlur={field.onBlur}
						invalid={field.errors.length > 0}
						describedById={describedBy}
					/>
				</FieldShell>
			)
	}
}

const WizardContent = ({ form }: { form: FormDocument }) => {
	const step = useFormStep()
	const { submitting, submitError } = useFormState()
	const fieldsByName = useMemo(() => new Map(form.fields.map((f) => [f.name, f])), [form.fields])

	const currentFields = useMemo(() => {
		if (!step.flow || !step.currentStepId) return form.fields
		const names = stepFieldNames(step.flow, step.currentStepId)
		return names.map((n) => fieldsByName.get(n)).filter(Boolean) as typeof form.fields
	}, [step.flow, step.currentStepId, form.fields, fieldsByName])

	const hasFlow = step.flow && step.stepCount > 1

	return (
		<>
			{hasFlow ? (
				<div
					style={{
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'flex-start',
						marginBottom: 24,
						padding: '20px 24px',
						background: COLORS.card,
						borderRadius: 12,
						boxShadow: COLORS.cardShadow,
					}}
				>
					{step.flow.steps.map((s, i) => (
						<div key={s.id}>
							<StepIndicator
								label={s.id}
								index={i}
								isActive={i === step.stepIndex}
								isDone={i < step.stepIndex}
							/>
							{i < step.flow.steps.length - 1 ? <Connector active={i < step.stepIndex} /> : null}
						</div>
					))}
				</div>
			) : null}

			<div
				style={{
					background: COLORS.card,
					borderRadius: 12,
					boxShadow: COLORS.cardShadow,
					padding: '28px 24px',
				}}
			>
				<FormLayout>
					{currentFields.map((f) => (
						<div key={f.name} style={{ marginBottom: 20 }}>
							<FieldRenderer
								name={f.name}
								blockType={f.blockType}
								label={f.label}
								required={f.required}
								options={(f as Record<string, unknown>).options as SelectOption[] | undefined}
							/>
						</div>
					))}
				</FormLayout>

				{submitError ? (
					<p role="alert" style={{ color: COLORS.danger, marginTop: 8, fontSize: 14 }}>
						{submitError}
					</p>
				) : null}

				<div
					style={{
						display: 'flex',
						justifyContent: 'space-between',
						marginTop: 28,
						paddingTop: 20,
						borderTop: `1px solid ${COLORS.border}`,
					}}
				>
					<div>
						{!step.isFirst ? (
							<button
								type="button"
								onClick={step.goBack}
								disabled={submitting}
								style={{
									padding: '10px 28px',
									borderRadius: 8,
									border: `1.5px solid ${COLORS.border}`,
									background: COLORS.white,
									color: COLORS.text,
									fontSize: 15,
									fontWeight: 500,
									cursor: 'pointer',
									transition: 'all 0.2s',
								}}
							>
								← Back
							</button>
						) : (
							<div />
						)}
					</div>
					{step.isTerminal ? (
						<button
							type="submit"
							disabled={submitting}
							style={{
								padding: '10px 36px',
								borderRadius: 8,
								border: 'none',
								background: submitting ? COLORS.pending : COLORS.active,
								color: COLORS.white,
								fontSize: 15,
								fontWeight: 600,
								cursor: submitting ? 'not-allowed' : 'pointer',
								transition: 'all 0.2s',
								boxShadow: '0 4px 14px rgba(108,99,255,0.3)',
							}}
						>
							{submitting ? 'Submitting...' : 'Submit'}
						</button>
					) : (
						<button
							type="button"
							onClick={step.goNext}
							disabled={submitting}
							style={{
								padding: '10px 36px',
								borderRadius: 8,
								border: 'none',
								background: COLORS.active,
								color: COLORS.white,
								fontSize: 15,
								fontWeight: 600,
								cursor: 'pointer',
								transition: 'all 0.2s',
								boxShadow: '0 4px 14px rgba(108,99,255,0.3)',
							}}
						>
							Next →
						</button>
					)}
				</div>
			</div>
		</>
	)
}

export const WizardForm = ({ form, ...formProps }: WizardFormProps) => {
	return (
		<Form form={form} {...formProps}>
			<WizardContent form={form} />
		</Form>
	)
}
