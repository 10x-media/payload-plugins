import { matchFields, readPath, tenantOf } from '@10x-media/dedupe'
import type { AdapterDoc, DedupeAdapter } from '@10x-media/dedupe/types'
import type { PayloadRequest } from 'payload'

type Connection = { url: string; apiKey: string }

/** A match field's name in Typesense, which reads a dot as a nested object. */
const fieldName = (path: string) => `f_${path.replaceAll('.', '__')}`

type Field = { path: string; name: string; phone: boolean }

const fieldsOf = (req: PayloadRequest, collection: string): Field[] =>
	matchFields(req.payload, collection).map((field) => ({
		path: field.path,
		name: fieldName(field.path),
		phone: field.compare === 'phone',
	}))

/** Every value of a field as text: each locale, each item of a list. A phone by its digits. */
const textsOf = (doc: AdapterDoc, field: Field): string[] => {
	const flat = (value: unknown): unknown[] =>
		Array.isArray(value)
			? value.flatMap(flat)
			: value !== null && typeof value === 'object'
				? Object.values(value).flatMap(flat)
				: [value]
	const texts = flat(readPath(doc, field.path))
		.filter((value) => value !== null && value !== undefined && String(value).trim() !== '')
		.map((value) => String(value).toLowerCase().trim())
	return [...new Set(field.phone ? texts.map((text) => text.replace(/\D/g, '').slice(-9)) : texts)]
}

/**
 * A candidate source backed by Typesense, switched on in the stand with
 * `DEDUPE_ADAPTER=typesense`. Each collection's match fields are indexed into a Typesense
 * collection of the same name, and a document's candidates are the ones Typesense finds by
 * its values, typos tolerated: it catches look-alikes that blocking keys miss. The scan calls
 * `findCandidates` per document. `pnpm dev:typesense` starts Typesense and the stand.
 */
export const typesenseAdapter = ({ url, apiKey }: Connection): DedupeAdapter => {
	const call = async (path: string, init: RequestInit = {}): Promise<Response> =>
		fetch(`${url}${path}`, {
			...init,
			headers: {
				'X-TYPESENSE-API-KEY': apiKey,
				'Content-Type': 'application/json',
				...init.headers,
			},
		})

	/** Creates the Typesense collection, or recreates it when the match fields changed. */
	const ready = new Map<string, Promise<void>>()
	const ensure = (req: PayloadRequest, collection: string): Promise<void> => {
		const known = ready.get(collection)
		if (known) return known
		const fields = [
			...fieldsOf(req, collection).map((field) => ({
				name: field.name,
				type: 'string[]',
				optional: true,
			})),
			{ name: 'tenant', type: 'string', facet: true, optional: true },
		]
		const pending = (async () => {
			const existing = await call(`/collections/${collection}`)
			if (existing.ok) {
				const schema = (await existing.json()) as { fields: { name: string }[] }
				const names = schema.fields.map((field) => field.name).sort()
				if (
					names.join() ===
					fields
						.map((field) => field.name)
						.sort()
						.join()
				)
					return
				await call(`/collections/${collection}`, { method: 'DELETE' })
			}
			const created = await call('/collections', {
				method: 'POST',
				body: JSON.stringify({ name: collection, fields }),
			})
			if (!created.ok) throw new Error(`typesense: ${created.status} ${await created.text()}`)
		})()
		ready.set(collection, pending)
		pending.catch(() => ready.delete(collection))
		return pending
	}

	return {
		index: async ({ req, collection, doc }) => {
			await ensure(req, collection)
			const tenant = tenantOf(req.payload, collection, doc)
			const body = Object.fromEntries([
				['id', String(doc.id)],
				...fieldsOf(req, collection).map((field) => [field.name, textsOf(doc, field)]),
				...(tenant ? [['tenant', tenant]] : []),
			])
			const response = await call(`/collections/${collection}/documents?action=upsert`, {
				method: 'POST',
				body: JSON.stringify(body),
			})
			if (!response.ok) throw new Error(`typesense: ${response.status} ${await response.text()}`)
		},

		remove: async ({ req, collection, id }) => {
			await ensure(req, collection)
			await call(`/collections/${collection}/documents/${encodeURIComponent(id)}`, {
				method: 'DELETE',
			})
		},

		findCandidates: async ({ req, collection, doc, limit }) => {
			await ensure(req, collection)
			const tenant = tenantOf(req.payload, collection, doc)
			// One search per value of each match field, typos tolerated.
			const searches = fieldsOf(req, collection).flatMap((field) =>
				textsOf(doc, field).map((q) => ({
					collection,
					q,
					query_by: field.name,
					num_typos: 2,
					prefix: false,
					per_page: Math.min(limit, 250),
					...(tenant ? { filter_by: `tenant:=${tenant}` } : {}),
				}))
			)
			if (searches.length === 0) return []
			const response = await call('/multi_search', {
				method: 'POST',
				body: JSON.stringify({ searches }),
			})
			if (!response.ok) throw new Error(`typesense: ${response.status} ${await response.text()}`)
			const { results } = (await response.json()) as {
				results: { hits?: { document: { id: string } }[] }[]
			}
			const ids = new Set<string>()
			for (const result of results) {
				for (const hit of result.hits ?? []) {
					if (hit.document.id !== String(doc.id ?? '')) ids.add(hit.document.id)
				}
			}
			return [...ids].slice(0, limit).map((id) => ({ id }))
		},
	}
}
