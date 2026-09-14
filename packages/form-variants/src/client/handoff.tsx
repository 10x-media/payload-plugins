'use client'

import { useForm, useFormModified } from '@payloadcms/ui'
import type { FormState } from 'payload'
import type React from 'react'
import { createContext, useContext, useEffect, useRef, useState } from 'react'

/** One form's state as it stood, handed to the form that takes its place. */
export type FormHandoff = {
	modified: boolean
	state: FormState
}

type HandoffContextValue = {
	/** The state the form on screen a moment ago left behind, or `null`. */
	handoff: FormHandoff | null
	/** Called once the handoff has been applied, so a later mount does not take it again. */
	release: () => void
	/** Registers the live form's state, read at the moment of a switch. */
	register: (capture: () => FormHandoff) => () => void
}

export const HandoffContext = createContext<HandoffContextValue | null>(null)

/**
 * Carries the form state across the `native` boundary, in both directions, so switching forms
 * keeps every value including the ones only the other form shows.
 *
 * It renders inside both forms: in a variant beside the runner, and on `native` through the
 * `BeforeDocumentControls` slot, which Payload renders inside its own `Form`. That is what lets
 * it read the live state through `useForm`, which the switcher cannot: the switcher answers to
 * the provider, which sits outside both forms.
 *
 * The handoff is applied one commit after mount on purpose. A `Form` replaces its own state
 * with `initialState` in a mount effect, and React runs a parent's effects after its children's,
 * so a dispatch made on this component's own mount would be overwritten by it.
 */
export const FormStateBridge: React.FC = () => {
	const context = useContext(HandoffContext)
	const { dispatchFields, getFields, setModified } = useForm()
	const modified = useFormModified()
	const [mounted, setMounted] = useState(false)
	const modifiedRef = useRef(modified)
	modifiedRef.current = modified

	const register = context?.register
	useEffect(
		() => register?.(() => ({ modified: modifiedRef.current, state: getFields() })),
		[getFields, register]
	)

	useEffect(() => {
		setMounted(true)
	}, [])

	useEffect(() => {
		if (!mounted || !context?.handoff) {
			return
		}
		dispatchFields({
			type: 'REPLACE_STATE',
			optimize: false,
			sanitize: true,
			state: context.handoff.state,
		})
		setModified(context.handoff.modified)
		context.release()
	}, [context, dispatchFields, mounted, setModified])

	return null
}
