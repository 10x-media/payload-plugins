'use client'

import {
	DefaultEditView,
	Gutter,
	useDocumentDrawerContext,
	useEditDepth,
	usePreferences,
} from '@payloadcms/ui'
import type React from 'react'
import { useCallback, useMemo, useState } from 'react'

import { BASE_CLASS, preferenceKeyFor, VARIANT_PARAM } from '../plugin/constants'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import type { WizardState } from '../types'
import { VariantSwitcher } from './chrome/VariantSwitcher'
import { FormVariantsContext, type FormVariantsContextValue, type SwitchOptions } from './context'
import { resolveSlot } from './slots'
import type { Outcome, VariantProviderProps } from './types'
import { replaceParam } from './url'
import { VariantForm } from './VariantForm'

const EmptyState: React.FC = () => {
	const { t } = useTranslation()
	return (
		<main className={`collection-edit ${BASE_CLASS} ${BASE_CLASS}--empty`}>
			<Gutter>
				<p className={`${BASE_CLASS}__empty`}>{t(keys.noVariants)}</p>
			</Gutter>
		</main>
	)
}

/**
 * Sits above every variant of the document: which one is active, wizard state, the outcome,
 * and switching. Picks the drawer or page answer the server prepared for both.
 *
 * `native` is Payload's `DefaultEditView` untouched, with the switcher in its
 * `BeforeDocumentControls` slot. Every other variant renders inside one `<Form>` the plugin
 * owns, so switching between two step variants keeps every value; switching to or from
 * `native` crosses into another form and asks first when there are unsaved changes.
 */
export const VariantProvider: React.FC<VariantProviderProps> = (props) => {
	const { availability, collectionSlug, documentSlots, initial, slots, storedSteps, variants } =
		props
	const { drawerSlug } = useDocumentDrawerContext()
	const depth = useEditDepth()
	const { setPreference } = usePreferences()

	const inDrawer = Boolean(drawerSlug) || depth > 1
	const surface = inDrawer ? 'drawer' : 'page'

	const available = useMemo(
		() =>
			availability[surface].flatMap((key) => {
				const variant = variants.find((candidate) => candidate.key === key)
				return variant ? [variant] : []
			}),
		[availability, surface, variants]
	)

	/** The remembered step of a sections variant, which the server left out for a guided one. */
	const rememberedStep = useCallback(
		(key: null | string): null | string => (key ? (storedSteps[key] ?? null) : null),
		[storedSteps]
	)

	const [activeKey, setActiveKey] = useState<null | string>(() => initial[surface])
	const [state, setState] = useState<WizardState>({})
	const [outcome, setOutcome] = useState<null | Outcome>(null)
	const [stepKey, setStepKey] = useState<null | string>(() => rememberedStep(initial[surface]))

	const switchTo = useCallback(
		(key: string, options?: SwitchOptions) => {
			if (!available.some((variant) => variant.key === key)) {
				return
			}
			setActiveKey(key)
			setOutcome(null)
			setStepKey(rememberedStep(key))
			if (!inDrawer) {
				replaceParam(VARIANT_PARAM, key)
			}
			if (options?.persist !== false) {
				void setPreference(preferenceKeyFor(collectionSlug), { variant: key })
			}
		},
		[available, collectionSlug, inDrawer, rememberedStep, setPreference]
	)

	const active = useMemo(
		() => variants.find((variant) => variant.key === activeKey) ?? null,
		[activeKey, variants]
	)

	const value = useMemo<FormVariantsContextValue>(
		() => ({
			active,
			available,
			collectionSlug,
			inDrawer,
			outcome,
			setOutcome,
			setState,
			setStepKey,
			state,
			stepKey,
			switchTo,
		}),
		[active, available, collectionSlug, inDrawer, outcome, state, stepKey, switchTo]
	)

	let content: React.ReactNode
	if (!active) {
		content = <EmptyState />
	} else if (active.native) {
		const switcher =
			available.length > 1
				? (resolveSlot('VariantSwitcher', [slots.collection, slots.plugin]) ?? <VariantSwitcher />)
				: null
		content = (
			<DefaultEditView
				{...documentSlots}
				BeforeDocumentControls={
					<>
						{documentSlots.BeforeDocumentControls}
						{switcher}
					</>
				}
			/>
		)
	} else {
		content = <VariantForm {...props} variant={active} />
	}

	return <FormVariantsContext value={value}>{content}</FormVariantsContext>
}
