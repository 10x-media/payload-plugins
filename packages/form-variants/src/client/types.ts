import type { DocumentViewClientProps, JsonObject } from 'payload'
import type React from 'react'

import type { ResolvedUI } from '../plugin/registry'

/** One entry of a field step, with labels resolved on the server. */
export type ClientFieldItem =
	| { description?: string; label?: string; path: string; type: 'field' }
	| { id: string; type: 'component' }

export type ClientStep = {
	description?: string
	/** Whether the step has a server-side `condition`, which the runner re-evaluates on every move. */
	hasCondition: boolean
	hasGate: boolean
	/** Whether `condition` passed at page render, against the document's saved values. */
	initiallyVisible: boolean
	items: ClientFieldItem[]
	key: string
	kind: 'component' | 'fields'
	label?: string
}

export type ClientVariant = {
	hasAfterSave: boolean
	key: string
	label: string
	native: boolean
	navigation: 'free' | 'linear'
	save: 'always' | 'final-step'
	steps: ClientStep[]
	ui: ResolvedUI
}

/** Server-rendered slot replacements. `undefined` means "use the built-in", `false` hides the part. */
export type RenderedSlots = {
	Layout?: React.ReactNode
	Navigation?: React.ReactNode
	Outcome?: React.ReactNode
	Progress?: React.ReactNode
	StepHeader?: React.ReactNode
	VariantSwitcher?: React.ReactNode
}

export type RenderedVariantSlots = {
	steps: Record<string, RenderedSlots>
	variant: RenderedSlots
}

/** Which variants the account may see and which one opens, per rendering surface. */
export type Availability = {
	drawer: string[]
	page: string[]
}

export type VariantProviderProps = {
	availability: Availability
	collectionSlug: string
	/** Payload's own view props and document slots (custom buttons, description), passed through to both surfaces. */
	documentSlots: DocumentViewClientProps
	initial: { drawer: null | string; page: null | string }
	/** The step each sections variant was last left on, by variant key. Empty on a new document. */
	storedSteps: Record<string, string>
	/** Component steps and component items, keyed `<variant>/<step>` and `<variant>/<step>/<index>`. */
	rendered: Record<string, React.ReactNode>
	slots: {
		collection: RenderedSlots
		plugin: RenderedSlots
		variants: Record<string, RenderedVariantSlots>
	}
	variants: ClientVariant[]
}

/** What `finish()` or an `outcome` after-save action leaves behind. */
export type Outcome = JsonObject
