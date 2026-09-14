'use client'

export {
	DefaultLayout,
	NavigationSlot,
	OutcomeSlot,
	ProgressSlot,
	StepBody,
	StepHeaderSlot,
} from '../client/chrome/Layout'
export { Navigation } from '../client/chrome/Navigation'
export { Outcome } from '../client/chrome/Outcome'
export { Progress } from '../client/chrome/Progress'
export { StepHeader } from '../client/chrome/StepHeader'
export { VariantSwitcher } from '../client/chrome/VariantSwitcher'
export {
	type BeforeNextHandler,
	type FormVariantsContextValue,
	type PrimaryAction,
	useFormVariants,
	useOutcome,
	useWizard,
	useWizardState,
	type WizardContextValue,
} from '../client/context'
export type {
	ClientFieldItem,
	ClientStep,
	ClientVariant,
	Outcome as OutcomeData,
} from '../client/types'
