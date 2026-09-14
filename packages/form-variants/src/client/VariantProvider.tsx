'use client'

import {
	DefaultEditView,
	Gutter,
	useDocumentDrawerContext,
	useEditDepth,
	usePreferences,
} from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import type React from 'react'
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'

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
	const router = useRouter()
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
	const [crossing, setCrossing] = useState<null | string>(null)
	const [refreshing, startRefresh] = useTransition()

	const active = useMemo(
		() => variants.find((variant) => variant.key === activeKey) ?? null,
		[activeKey, variants]
	)

	const apply = useCallback(
		(key: string) => {
			setActiveKey(key)
			setOutcome(null)
			setStepKey(rememberedStep(key))
			if (!inDrawer) {
				replaceParam(VARIANT_PARAM, key)
			}
		},
		[inDrawer, rememberedStep]
	)

	/**
	 * Crossing between `native` and a variant leaves one form for another, and the form being
	 * mounted starts from the state the server rendered with the page. That state is as old as
	 * the page: anything saved since, by either form, is not in it, so the new form would open
	 * on the values the document had when it was opened. The server render is what holds it, so
	 * the route is refreshed first and the switch waits for the answer.
	 *
	 * A drawer has no route of its own: its document is rendered once by `renderDocument` when
	 * the drawer opens and only the drawer itself can ask for it again, so there the switch
	 * crosses with the state the drawer opened on.
	 */
	const switchTo = useCallback(
		(key: string, options?: SwitchOptions) => {
			const target = available.find((variant) => variant.key === key)
			if (!target) {
				return
			}
			if (options?.persist !== false) {
				void setPreference(preferenceKeyFor(collectionSlug), { variant: key })
			}
			if (!inDrawer && active && target.native !== active.native) {
				setCrossing(key)
				startRefresh(() => router.refresh())
				return
			}
			apply(key)
		},
		[active, apply, available, collectionSlug, inDrawer, router, setPreference]
	)

	useEffect(() => {
		if (crossing && !refreshing) {
			apply(crossing)
			setCrossing(null)
		}
	}, [apply, crossing, refreshing])

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
