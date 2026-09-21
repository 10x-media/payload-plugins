import type { ServerProps } from 'payload'

import { collectionBySlug } from '../ids'
import { IMPERSONATION_SID_PREFIX } from '../plugin/constants'
import { readHintCookie } from '../plugin/lookup'
import { getRegistry } from '../plugin/registry'
import { isStartableAuthCollection } from '../plugin/startable'
import { findOpenBySid } from '../session/resolve'
import { asAuthUser, boundSid } from '../types'
import { ImpersonationSwitcher } from './ImpersonationSwitcher'

export const ImpersonationAction = async ({ payload, user }: ServerProps) => {
	const options = getRegistry(payload.config)
	if (!options?.ui.headerAction || !user) {
		return null
	}

	if (user.collection !== payload.config.admin.user) {
		return null
	}

	if (asAuthUser(user)._impersonation) {
		return null
	}

	const sid = boundSid(user, options.session.binding)
	if (!sid) {
		return null
	}

	const hint = await readHintCookie(options.hintCookieName)
	const shouldLookup =
		Boolean(options.session.issue) || Boolean(hint) || sid.startsWith(IMPERSONATION_SID_PREFIX)
	if (shouldLookup) {
		const active = await findOpenBySid({ options, payload, sid })
		if (active) {
			return null
		}
	}

	const collections = payload.config.collections.flatMap((collection) => {
		if (!isStartableAuthCollection(collection, options)) {
			return []
		}
		const registered = collectionBySlug(payload, collection.slug)
		const plural = registered?.config.labels?.plural
		return [
			{
				label: plural ? String(plural) : collection.slug,
				slug: collection.slug,
				useAsTitle: collection.admin?.useAsTitle ?? 'email',
			},
		]
	})

	if (collections.length === 0) {
		return null
	}

	return <ImpersonationSwitcher collections={collections} viewerId={user.id} />
}
