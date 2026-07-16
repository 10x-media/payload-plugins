'use client'

import type { ReactNode } from 'react'
import { cn } from './cn'
import { useFormContext } from './FormContext'

/** Props passed to `renderSubmit`. */
export type SubmitButtonRenderProps = {
	label: string
	submitting: boolean
}

/** Props passed to `renderNext`. */
export type NextButtonRenderProps = {
	label: string
	submitting: boolean
	onClick: () => void
}

/** Props passed to `renderBack`. */
export type BackButtonRenderProps = {
	label: string
	submitting: boolean
	onClick: () => void
}

export type FormControlsProps = {
	/** Override the context-resolved back label for this instance. */
	backLabel?: string
	/** Override the context-resolved next label for this instance. */
	nextLabel?: string
	/** Override the context-resolved submit label for this instance. */
	submitLabel?: string
	/** Additional CSS class on the wrapping `.fb-form__controls` element. */
	className?: string
	/** CSS class forwarded to the default "Back" `<button>`. Ignored when `renderBack` is provided. */
	backButtonClassName?: string
	/** CSS class forwarded to the default "Next" `<button>`. Ignored when `renderNext` is provided. */
	nextButtonClassName?: string
	/** CSS class forwarded to the default submit `<button>`. Ignored when `renderSubmit` is provided. */
	submitButtonClassName?: string
	/** Replace the default "Back" button entirely. */
	renderBack?: (props: BackButtonRenderProps) => ReactNode
	/** Replace the default "Next" button entirely. */
	renderNext?: (props: NextButtonRenderProps) => ReactNode
	/** Replace the default submit button entirely. Receives the resolved label and submitting state. */
	renderSubmit?: (props: SubmitButtonRenderProps) => ReactNode
}

/**
 * The form's navigation chrome: back on non-first steps, next on non-terminal steps, submit on
 * the terminal step (a single-step form is first and terminal, so it gets only submit). Driven
 * entirely by the form context, so it composes into custom `children` layouts exactly like the
 * default field loop's chrome. Labels resolve from context (`<Form>` props, the form's
 * `buttons` labels, translated defaults) unless overridden per button here. Must render
 * inside `<Form>`, within its `<form>` element so the submit button submits.
 */
export const FormControls = ({
	backLabel,
	nextLabel,
	submitLabel,
	className,
	backButtonClassName,
	nextButtonClassName,
	submitButtonClassName,
	renderBack,
	renderNext,
	renderSubmit,
}: FormControlsProps) => {
	const { state, step, labels } = useFormContext()
	const submitting = state.submitting
	const back = backLabel ?? labels.back
	const next = nextLabel ?? labels.next
	const submit = submitLabel ?? labels.submit
	return (
		<div className={cn('fb-form__controls', className)}>
			{!step.isFirst ? (
				renderBack ? (
					renderBack({ label: back, submitting, onClick: step.goBack })
				) : (
					<button
						type="button"
						className={cn('fb-form__back', backButtonClassName)}
						onClick={step.goBack}
						disabled={submitting}
					>
						{back}
					</button>
				)
			) : null}
			{step.isTerminal ? (
				renderSubmit ? (
					renderSubmit({ label: submit, submitting })
				) : (
					<button
						type="submit"
						className={cn('fb-form__submit', submitButtonClassName)}
						disabled={submitting}
					>
						{submit}
					</button>
				)
			) : renderNext ? (
				renderNext({ label: next, submitting, onClick: step.goNext })
			) : (
				<button
					type="button"
					className={cn('fb-form__next', nextButtonClassName)}
					onClick={step.goNext}
					disabled={submitting}
				>
					{next}
				</button>
			)}
		</div>
	)
}
