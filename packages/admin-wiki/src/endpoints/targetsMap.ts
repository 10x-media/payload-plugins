import type { CollectionSlug, Endpoint, PayloadRequest } from 'payload'

import type { WikiAccessOptions } from '../options'
import { resolveReaderLocale } from '../shared/resolveLocale'
import {
	compareTargetEntries,
	targetKeyForRow,
	type WikiTargetEntry,
	type WikiTargetRow,
	type WikiTargetsResponse,
} from '../shared/targetKeys'

type BuildTargetsMapEndpointArgs = {
	access: Required<WikiAccessOptions>
	localeMap: Record<string, string>
	pagesSlug: string
}

const contentLocaleCodes = (req: PayloadRequest): string[] => {
	const localization = req.payload.config.localization
	if (!localization) {
		return []
	}
	return localization.locales.map((locale) => (typeof locale === 'string' ? locale : locale.code))
}

/**
 * `GET /api/<pages>/targets-map`: a compact map of target key to the published
 * guides attached to it, resolved for the reader's admin language, plus the
 * evaluated create permission driving the "write this guide" affordance.
 * Read access applies through the normal collection access (never overridden);
 * full guide content is deliberately absent and loads lazily on open.
 */
export const buildTargetsMapEndpoint = ({
	access,
	localeMap,
	pagesSlug,
}: BuildTargetsMapEndpointArgs): Endpoint => ({
	handler: async (req) => {
		const language = req.searchParams.get('language') ?? undefined
		const localization = req.payload.config.localization
		const locale = resolveReaderLocale({
			contentLocales: contentLocaleCodes(req),
			defaultLocale: localization ? localization.defaultLocale : undefined,
			language,
			localeMap,
		})
		if (locale) {
			req.locale = locale
		}
		try {
			const result = await req.payload.find({
				collection: pagesSlug as CollectionSlug,
				depth: 0,
				draft: false,
				overrideAccess: false,
				pagination: false,
				req,
				select: {
					featured: true,
					featuredOrder: true,
					slug: true,
					summary: true,
					targets: true,
					title: true,
				},
				user: req.user,
				where: { _status: { equals: 'published' } },
				...(locale
					? {
							fallbackLocale: localization ? localization.defaultLocale : undefined,
							locale,
						}
					: {}),
			})
			const targets: Record<string, WikiTargetEntry[]> = {}
			for (const doc of result.docs as Array<
				Record<string, unknown> & { id: number | string; targets?: WikiTargetRow[] | null }
			>) {
				const entry: WikiTargetEntry = {
					featured: doc.featured === true,
					featuredOrder: typeof doc.featuredOrder === 'number' ? doc.featuredOrder : null,
					id: doc.id,
					slug: typeof doc.slug === 'string' ? doc.slug : null,
					summary: typeof doc.summary === 'string' ? doc.summary : null,
					title: typeof doc.title === 'string' ? doc.title : null,
				}
				for (const row of doc.targets ?? []) {
					const key = targetKeyForRow(row)
					if (key) {
						const bucket = targets[key] ?? []
						bucket.push(entry)
						targets[key] = bucket
					}
				}
			}
			for (const bucket of Object.values(targets)) {
				bucket.sort(compareTargetEntries)
			}
			const canCreate = Boolean(await access.create({ req }))
			const canUpdate = Boolean(await access.update({ req }))
			const body: WikiTargetsResponse = {
				canCreate,
				canUpdate,
				locale: locale ?? null,
				targets,
			}
			return Response.json(body, { headers: { 'cache-control': 'no-store' } })
		} catch (error) {
			const status =
				typeof (error as { status?: unknown }).status === 'number'
					? (error as { status: number }).status
					: 500
			return Response.json(
				{ canCreate: false, canUpdate: false, locale: null, targets: {} },
				{ status }
			)
		}
	},
	method: 'get',
	path: '/targets-map',
})
