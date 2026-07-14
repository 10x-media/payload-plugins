'use client'

import { Form, type FormDocument } from '@10x-media/form-builder/react'
import { useCallback, useMemo, useState } from 'react'

type FlowStep = { id: string; fields: string[]; next?: string }
type Flow = { steps: FlowStep[] }

type StepStatus = 'done' | 'active' | 'pending'

type WizardFormProps = {
	form: FormDocument & { flow?: Flow }
	/**
	 * Controlled active step id. Pass this if the parent already knows which
	 * step the form-builder is on (e.g. from its own step-change callback).
	 * When omitted, WizardForm tracks the step itself, starting at the first
	 * step and advancing whenever it sees a `stepChange`-shaped event come
	 * through `events.emit` (see `deriveStepIdFromEvent` below).
	 */
	activeStepId?: string
	/** Called when the user clicks a completed step to jump back to it. Omit to disable back-navigation. */
	onStepSelect?: (stepId: string) => void
	events?: { emit: (event: unknown) => void }
	[key: string]: unknown
}

/** Extracts stepId from a `step.viewed` event emitted by the form-builder. */
function deriveStepIdFromEvent(event: unknown): string | undefined {
	if (!event || typeof event !== 'object') return undefined
	const e = event as Record<string, unknown>
	const type = e.type ?? e.name
	if (type !== 'step.viewed') return undefined
	const candidate = e.stepId
	return typeof candidate === 'string' ? candidate : undefined
}

function statusOf(index: number, activeIndex: number): StepStatus {
	if (index < activeIndex) return 'done'
	if (index === activeIndex) return 'active'
	return 'pending'
}

const WizardNav = ({
	steps,
	activeIndex,
	onStepSelect,
}: {
	steps: FlowStep[]
	activeIndex: number
	onStepSelect?: (stepId: string) => void
}) => (
	<>
		<style>{`
			.wf-nav { display: flex; align-items: flex-start; gap: 0; margin-bottom: 24px; padding: 20px 24px; background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.06); overflow-x: auto; }
			.wf-step { display: flex; align-items: center; flex: 1 0 auto; }
			.wf-step:last-child { flex: 0 0 auto; }
			.wf-dot { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; flex-shrink: 0; transition: background-color 0.2s ease, color 0.2s ease; }
			.wf-dot--pending { background: #E0E0E0; color: #999; }
			.wf-dot--active { background: #6C63FF; color: #fff; }
			.wf-dot--done { background: #4CAF50; color: #fff; }
			.wf-label { margin: 0 12px; font-size: 13px; font-weight: 500; color: #1A1A2E; white-space: nowrap; }
			.wf-label--pending { color: #6B7280; }
			.wf-connector { height: 2px; flex: 1 1 32px; min-width: 24px; background: #E0E0E0; transition: background-color 0.2s ease; }
			.wf-connector--done { background: #4CAF50; }
			.wf-step-btn { background: none; border: none; padding: 0; cursor: pointer; font: inherit; display: flex; align-items: center; border-radius: 6px; }
			.wf-step-btn:focus-visible { outline: 2px solid #6C63FF; outline-offset: 2px; }
			@media (prefers-reduced-motion: reduce) {
				.wf-dot, .wf-connector { transition: none; }
			}
		`}</style>
		<ol className="wf-nav" aria-label="Form progress">
			{steps.map((s, i) => {
				const status = statusOf(i, activeIndex)
				const clickable = status === 'done' && !!onStepSelect
				const dot = (
					<div className={`wf-dot wf-dot--${status}`}>{status === 'done' ? '✓' : i + 1}</div>
				)
				return (
					<li
						key={s.id}
						className="wf-step"
						aria-current={status === 'active' ? 'step' : undefined}
					>
						{clickable ? (
							<button
								type="button"
								className="wf-step-btn"
								onClick={() => onStepSelect?.(s.id)}
								aria-label={`Go back to ${s.id}`}
							>
								{dot}
								<span className={`wf-label wf-label--${status}`}>{s.id}</span>
							</button>
						) : (
							<>
								{dot}
								<span className={`wf-label wf-label--${status}`}>{s.id}</span>
							</>
						)}
						{i < steps.length - 1 ? (
							<div className={`wf-connector ${status === 'done' ? 'wf-connector--done' : ''}`} />
						) : null}
					</li>
				)
			})}
		</ol>
	</>
)

export const WizardForm = ({
	form,
	activeStepId,
	onStepSelect,
	events,
	...formProps
}: WizardFormProps) => {
	const flow = form.flow
	const isWizard = form.defaultPresentation === 'wizard'
	const steps = flow?.steps ?? []
	const hasFlow = steps.length > 1

	const [trackedStepId, setTrackedStepId] = useState<string | undefined>(steps[0]?.id)

	const wrappedEvents = useMemo(() => {
		if (!events) return undefined
		return {
			emit: (event: unknown) => {
				const stepId = deriveStepIdFromEvent(event)
				if (stepId) setTrackedStepId(stepId)
				events.emit(event)
			},
		}
	}, [events])

	const currentStepId = activeStepId ?? trackedStepId
	const activeIndex = Math.max(
		0,
		steps.findIndex((s) => s.id === currentStepId)
	)

	const handleStepSelect = useCallback(
		(stepId: string) => {
			if (activeStepId === undefined) setTrackedStepId(stepId)
			onStepSelect?.(stepId)
		},
		[activeStepId, onStepSelect]
	)

	return (
		<>
			{isWizard && hasFlow ? (
				<WizardNav steps={steps} activeIndex={activeIndex} onStepSelect={handleStepSelect} />
			) : null}
			<Form
				form={form}
				events={wrappedEvents}
				{...(isWizard ? { presentation: 'wizard' } : {})}
				{...formProps}
			/>
		</>
	)
}
