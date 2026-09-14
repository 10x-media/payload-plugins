'use client'

import type { JsonValue } from 'payload'
import { createContext, useCallback, useContext } from 'react'

import type { WizardState } from '../types'
import type { ClientStep, ClientVariant, Outcome } from './types'

export type SwitchOptions = {
	/** Store the choice as the account's preference for this collection. Default `true`. */
	persist?: boolean
}

/** What every variant of a document shares: which one is active, wizard state, the outcome. */
export type FormVariantsContextValue = {
	active: ClientVariant | null
	/** The variants this account may see on this surface (page or drawer), in config order. */
	available: ClientVariant[]
	collectionSlug: string
	inDrawer: boolean
	outcome: null | Outcome
	setOutcome: (outcome: null | Outcome) => void
	setState: (updater: (state: WizardState) => WizardState) => void
	setStepKey: (key: null | string) => void
	state: WizardState
	/** The current step key, kept in memory; the full page mirrors it into `?step=`. */
	stepKey: null | string
	switchTo: (key: string, options?: SwitchOptions) => void
}

export const FormVariantsContext = createContext<FormVariantsContextValue | null>(null)

/** The active variant, the available ones, and `switchTo`. Works on `native` too. */
export const useFormVariants = (): FormVariantsContextValue => {
	const value = useContext(FormVariantsContext)
	if (!value) {
		throw new Error('useFormVariants must be used inside a form-variants edit view.')
	}
	return value
}

/** Client-side counterpart of a gate. Returning `false` refuses the move. */
export type BeforeNextHandler = (args: {
	step: ClientStep
}) => boolean | Promise<boolean | undefined> | undefined

/**
 * A step's replacement for the footer's primary button, so a component step drives the same
 * footer as every other step instead of drawing buttons of its own.
 */
export type PrimaryAction = {
	disabled?: boolean
	label: string
	onClick: () => Promise<unknown> | unknown
}

/** The wizard API a step, a slot or any component inside a variant reads. */
export type WizardContextValue = {
	allowSave: () => void
	back: () => Promise<void>
	blockSave: (reason: string) => void
	/** True while a move is validating, evaluating a gate, or waiting for the server. */
	busy: boolean
	count: number
	/** The last gate refusal, validation or server message, cleared on the next successful move. */
	error: null | string
	/** Ends the wizard without a native save and shows the `Outcome` slot. */
	finish: (outcome: Outcome) => void
	goTo: (key: string) => Promise<void>
	index: number
	isFirst: boolean
	isLast: boolean
	/** The current step's own footer message, set with `setMessage`. */
	message: null | string
	next: () => Promise<boolean>
	onBeforeNext: (handler: BeforeNextHandler) => () => void
	/** The current step's replacement for the footer's primary button, if any. */
	primaryAction: null | PrimaryAction
	readOnly: boolean
	/** Saves through the guard: a refused save resolves without submitting. */
	save: () => Promise<void>
	saveAllowed: boolean
	/** Why the guard refuses, when it does. */
	saveBlockedReason: 'blocked' | 'finished' | 'not-final-step' | 'read-only' | null
	/** The consumer's `blockSave` reason, when set. */
	saveBlockedMessage: null | string
	/** Shows a message in the footer. Cleared when the step changes. */
	setMessage: (message: null | string) => void
	/** Replaces the footer's primary button; `null` restores Next or Save. Cleared when the step changes. */
	setPrimaryAction: (action: null | PrimaryAction) => void
	step: ClientStep | null
	/** The visible steps, in order. */
	steps: ClientStep[]
	variant: ClientVariant
}

export const WizardContext = createContext<WizardContextValue | null>(null)

/** The current step, the visible steps, navigation, the save guard and `finish`. */
export const useWizard = (): WizardContextValue => {
	const value = useContext(WizardContext)
	if (!value) {
		throw new Error('useWizard must be used inside a form variant with steps.')
	}
	return value
}

/** `[value, setValue]` over one key of the wizard state. */
export const useWizardState = <T extends JsonValue = JsonValue>(
	key: string
): [T | undefined, (value: T) => void] => {
	const { setState, state } = useFormVariants()
	const set = useCallback(
		(value: T) => {
			setState((previous) => ({ ...previous, [key]: value }))
		},
		[key, setState]
	)
	return [state[key] as T | undefined, set]
}

/** The data `finish(outcome)` or an `outcome` after-save action left behind, if any. */
export const useOutcome = (): null | Outcome => useFormVariants().outcome
