import { itemAttributesFor } from '@10x-media/analytics'
import { goalAttributes } from '@10x-media/analytics/attributes'
import config from '@payload-config'
import { headers } from 'next/headers'
import { getPayload } from 'payload'
import { OFFER_GOAL } from '../config/shared'
import { tenantForHost } from '../config/tenancy'

/**
 * The visiting tenant's offer, as a card marked as a content item and signed on the server. It
 * resolves the tenant from the host as the scope resolver does, so the card always belongs to the
 * tenant the visit is counted under. Renders nothing without one, and in single-site mode.
 */
export const OfferCard = async () => {
	const payload = await getPayload({ config })
	if (!('offers' in payload.collections) || !('tenants' in payload.collections)) {
		return null
	}
	const tenant = await tenantForHost(payload, (await headers()).get('host'))
	if (!tenant) {
		return null
	}
	const offers = await payload.find({
		collection: 'offers',
		where: { tenant: { equals: tenant.id } },
		limit: 1,
		depth: 0,
	})
	const offer = offers.docs[0]
	if (!offer) {
		return null
	}
	return (
		<aside
			{...itemAttributesFor(payload, { collection: 'offers', id: offer.id, name: offer.title })}
			style={{
				border: '1px solid color-mix(in srgb, CanvasText 20%, transparent)',
				borderRadius: '0.75rem',
				margin: '2rem 0',
				padding: '1rem 1.25rem',
			}}
		>
			<strong>{offer.title}</strong>
			<p style={{ margin: '0.5rem 0 1rem' }}>
				A card marked with <code>itemAttributesFor</code>: seeing it for a second counts a view of
				this offer, a click anywhere on it counts a click, and the button completes the{' '}
				<code>{OFFER_GOAL}</code> goal for it.
			</p>
			{/* Not labelled "Book a demo": the home page has that button, and e2e specs click it by name. */}
			<button {...goalAttributes(OFFER_GOAL)} type="button">
				Claim this offer
			</button>
		</aside>
	)
}
