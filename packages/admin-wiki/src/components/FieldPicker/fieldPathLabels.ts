/**
 * Localized breadcrumbs for a stored field target's path. Pure, so the segment
 * arithmetic can be checked without a form around it.
 */

import type { ClientField } from 'payload'
import { groupHasName, toWords } from 'payload/shared'

import { resolveClientLabel } from '../TargetSelect/clientBlocks'

type Step = {
	/** Labels this segment contributes, outermost first. */
	crumbs: string[]
	/** Where the next segment is looked up; absent when the match is a leaf. */
	fields?: ClientField[]
}

const labelOf = (label: unknown, fallback: string, language: string): string =>
	resolveClientLabel(label, language, fallback)

const ownLabel = (field: { label?: unknown }, name: string, language: string): string =>
	labelOf(field.label, toWords(name), language)

/**
 * Find one path segment among a field list, descending through the structural
 * fields the path does not name.
 *
 * Rows, unnamed tabs, and unnamed groups add no segment and no crumb: they are
 * invisible to the path and say nothing about where a field lives. A collapsible
 * adds no segment either but does carry a label the author gave it, so it is
 * kept as a crumb, which is the same call `reduceFieldsToOptions` makes for
 * Payload's own filter menus.
 */
const findSegment = (fields: ClientField[], name: string, language: string): null | Step => {
	for (const field of fields) {
		if ('name' in field && field.name === name) {
			return {
				crumbs: [ownLabel(field, name, language)],
				fields: 'fields' in field ? field.fields : undefined,
			}
		}
		switch (field.type) {
			case 'collapsible': {
				const hit = findSegment(field.fields, name, language)
				if (hit) {
					const crumb = labelOf(field.label, '', language)
					return crumb ? { ...hit, crumbs: [crumb, ...hit.crumbs] } : hit
				}
				break
			}
			case 'group': {
				// A named group was already matched above; its interior is only
				// reachable through a path that names it.
				const hit = groupHasName(field) ? null : findSegment(field.fields, name, language)
				if (hit) {
					return hit
				}
				break
			}
			case 'row': {
				const hit = findSegment(field.fields, name, language)
				if (hit) {
					return hit
				}
				break
			}
			case 'tabs': {
				for (const tab of field.tabs) {
					if ('name' in tab && tab.name === name) {
						return { crumbs: [ownLabel(tab, name, language)], fields: tab.fields }
					}
					const hit = 'name' in tab ? null : findSegment(tab.fields, name, language)
					if (hit) {
						return hit
					}
				}
				break
			}
			default:
				break
		}
	}
	return null
}

/**
 * Resolve an index-free schema path into the labels an author reads, outermost
 * first: `branding.links.url` becomes `Branding › Links › URL`.
 *
 * Returns an empty array when any segment fails to resolve, rather than a
 * partial trail. A path that no longer matches the config is exactly the case
 * the raw stored value is worth showing for, and half a breadcrumb would hide
 * which half went missing.
 *
 * A path never crosses a blocks field, since fields inside a block are rooted at
 * the block's own slug, so a segment that lands on one is always the last.
 */
export const resolveFieldPathCrumbs = (
	path: string,
	fields: ClientField[] | undefined,
	language: string
): string[] => {
	if (!fields) {
		return []
	}
	const crumbs: string[] = []
	let current: ClientField[] | undefined = fields
	for (const segment of path.split('.')) {
		if (!current) {
			return []
		}
		const step = findSegment(current, segment, language)
		if (!step) {
			return []
		}
		crumbs.push(...step.crumbs)
		current = step.fields
	}
	return crumbs
}
