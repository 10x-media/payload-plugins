import type { ServerProps } from 'payload'

import { collectionBySlug } from '../ids'
import { getRegistry } from '../plugin/registry'
import { findOpenBySid } from '../session/resolve'
import { boundSid } from '../types'
import { ImpersonationSwitcher } from './ImpersonationSwitcher'

export const ImpersonationAction = async ({ payload, user }: ServerProps) => {
	const options = getRegistry(payload.config)
	if (!options?.ui.headerAction || !user) {
		return null
	}

	if (user.collection !== payload.config.admin.user) {
		return null
	}

	const sid = boundSid(user, options.session.binding)
	if (!sid) {
		return null
	}

	const active = await findOpenBySid({ options, payload, sid })
	if (active) {
		return null
	}

	const collections = (
		options.targets ?? payload.config.collections.map(({ slug }) => slug)
	).flatMap((slug) => {
		if (slug === options.collectionSlug) {
			return []
		}
		const registered = collectionBySlug(payload, slug)
		if (!registered?.config.auth) {
			return []
		}
		const plural = registered.config.labels?.plural
		return [{ label: plural ? String(plural) : slug, slug }]
	})

	if (collections.length === 0) {
		return null
	}

	return (
		<ImpersonationSwitcher
			apiPath={`${payload.config.routes.api}${options.apiPath}`}
			collections={collections}
			reasonMode={options.reason}
			viewerId={user.id}
		/>
	)
}
