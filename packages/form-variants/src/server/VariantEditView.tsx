import { DefaultEditView } from '@payloadcms/ui'
import type {
	DocumentSlots,
	DocumentViewClientProps,
	DocumentViewServerProps,
	JsonObject,
} from 'payload'
import type React from 'react'
import type { Availability, RenderedVariantSlots, VariantProviderProps } from '../client/types'
import { VariantProvider } from '../client/VariantProvider'
import { STEP_PARAM, VARIANT_PARAM } from '../plugin/constants'
import { getCollectionVariants, getRegistry } from '../plugin/registry'
import { buildContext, evaluateVisibility, filterAvailable, withValues } from './evaluate'
import { buildClientVariant } from './manifest'
import { getStoredChoice } from './preferences'
import { renderSlots, renderVariant } from './render'
import { selectVariant } from './select'

const DOCUMENT_SLOT_KEYS = [
	'BeforeDocumentControls',
	'Description',
	'EditMenuItems',
	'LivePreview',
	'PreviewButton',
	'PublishButton',
	'SaveButton',
	'SaveDraftButton',
	'Status',
	'UnpublishButton',
	'Upload',
	'UploadControls',
] as const satisfies readonly (keyof DocumentSlots)[]

/** The client half of the view's props: Payload's document slots plus the view identifiers. */
const pickClientProps = (props: DocumentViewServerProps): DocumentViewClientProps => {
	const out: Record<string, unknown> = {
		documentSubViewType: props.documentSubViewType,
		formState: props.formState,
		viewType: props.viewType,
	}
	for (const key of DOCUMENT_SLOT_KEYS) {
		const value = (props as Record<string, unknown>)[key]
		if (value !== undefined) {
			out[key] = value
		}
	}
	return out as DocumentViewClientProps
}

const firstParam = (value: string | string[] | undefined): null | string =>
	Array.isArray(value) ? (value[0] ?? null) : (value ?? null)

/**
 * The collection's edit view, registered as `admin.components.views.edit.default`, so it
 * serves the full page and every document drawer alike.
 *
 * Runs per request with `req`: decides which variants this account may see, which one opens,
 * resolves labels, evaluates initial step visibility, and pre-renders every component step and
 * slot of every available variant. `inDrawer` has no server-side source, so access and the
 * default are evaluated for both values and the client picks by where it finds itself.
 */
export const VariantEditView = async (props: DocumentViewServerProps): Promise<React.ReactNode> => {
	const { doc, hasPublishedDoc, initPageResult, payload, searchParams } = props
	const { collectionConfig, docID, req } = initPageResult
	const documentSlots = pickClientProps(props)

	const collection = collectionConfig
		? getCollectionVariants(payload.config, collectionConfig.slug)
		: undefined
	if (!collection || !collectionConfig) {
		return <DefaultEditView {...documentSlots} />
	}

	const registry = getRegistry(payload.config)
	const operation = docID ? 'update' : 'create'
	const document = (doc ?? null) as JsonObject | null
	const requested = firstParam(searchParams?.[VARIANT_PARAM])
	const stored = await getStoredChoice(req, collectionConfig.slug)

	const availability: Availability = { drawer: [], page: [] }
	const initial: VariantProviderProps['initial'] = { drawer: null, page: null }

	for (const surface of ['page', 'drawer'] as const) {
		const ctx = buildContext({
			doc: document,
			hasPublishedDoc,
			inDrawer: surface === 'drawer',
			operation,
			req,
		})
		const available = (await filterAvailable(collection.variants, ctx)).map(
			(variant) => variant.key
		)
		const defaultKey =
			typeof collection.defaultVariant === 'function'
				? await collection.defaultVariant(ctx)
				: collection.defaultVariant
		availability[surface] = available
		initial[surface] = selectVariant({
			available,
			defaultKey,
			requested: surface === 'page' ? requested : null,
			stored,
		})
	}

	const union = collection.variants.filter(
		(variant) =>
			availability.page.includes(variant.key) || availability.drawer.includes(variant.key)
	)

	const pageCtx = withValues(
		buildContext({ doc: document, hasPublishedDoc, inDrawer: false, operation, req }),
		document ?? {},
		{}
	)
	const renderArgs = {
		importMap: payload.importMap,
		serverProps: {
			i18n: req.i18n,
			locale: props.locale,
			payload,
			permissions: props.permissions,
			req,
			user: req.user,
		},
	}

	const rendered: Record<string, React.ReactNode> = {}
	const variantSlots: Record<string, RenderedVariantSlots> = {}
	const variants: VariantProviderProps['variants'] = []

	for (const variant of union) {
		const visible = variant.native ? [] : await evaluateVisibility(variant, pageCtx)
		variants.push(buildClientVariant(variant, { i18n: req.i18n, visible }))
		const result = renderVariant(renderArgs, collection, variant)
		Object.assign(rendered, result.rendered)
		variantSlots[variant.key] = result.slots
	}

	const shared = { collection: collectionConfig.slug }

	return (
		<VariantProvider
			availability={availability}
			collectionSlug={collectionConfig.slug}
			documentSlots={documentSlots}
			initial={initial}
			initialStep={firstParam(searchParams?.[STEP_PARAM])}
			rendered={rendered}
			slots={{
				collection: renderSlots(renderArgs, collection.components, shared),
				plugin: renderSlots(renderArgs, registry?.components, shared),
				variants: variantSlots,
			}}
			variants={variants}
		/>
	)
}
