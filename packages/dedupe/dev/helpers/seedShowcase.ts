import type { CollectionSlug, Payload } from 'payload'

const SHOWCASES = 'showcases' as CollectionSlug

/**
 * Dev stand only: three look-alike companies in the `showcases` collection, whose custom
 * fields differ in every way the merge screen has to draw: a group differing in one of its
 * parts, rows in common and rows of their own, and empty values. Idempotent.
 */
export const seedShowcase = async (payload: Payload): Promise<void> => {
	const existing = await payload.count({ collection: SHOWCASES })
	if (existing.totalDocs > 0) return
	const tenants = await payload.find({
		collection: 'tenants' as CollectionSlug,
		where: { slug: { equals: 'kyiv' } },
		limit: 1,
	})
	const tenant = tenants.docs[0]?.id
	if (tenant === undefined) return

	const docs = [
		{
			name: 'Aurora Lighting GmbH',
			email: 'hello@aurora.example',
			website: 'https://aurora.example',
			color: '#ff8800',
			rating: 4,
			phone: { country: '+49', number: '30 1234567' },
			budget: { amount: 5000, currency: 'EUR' },
			contacts: [
				{ person: 'Olena Koval', role: 'owner', city: 'Kyiv' },
				{ person: 'Max Weber', role: 'billing', city: 'Berlin' },
			],
			labels: [{ text: 'Partner', tone: 'success' }],
			sections: [
				{ blockType: 'heading', text: 'About us' },
				{ blockType: 'callout', title: 'Shipping', body: 'Ships within the EU only.' },
			],
		},
		// Same company: the same email, the same phone number under another country code,
		// the same budget in another currency, one contact in common and one of its own.
		{
			name: 'Aurora Lighting',
			email: 'hello@aurora.example',
			website: 'https://www.aurora.example',
			color: '#ff7700',
			rating: 5,
			phone: { country: '+380', number: '30 1234567' },
			budget: { amount: 5000, currency: 'USD' },
			contacts: [
				{ person: 'Olena Koval', role: 'owner', city: 'Kyiv' },
				{ person: 'Iryna Bondar', role: 'technical', city: 'Lviv' },
			],
			labels: [
				{ text: 'Partner', tone: 'success' },
				{ text: 'Late payer', tone: 'warning' },
			],
			sections: [{ blockType: 'heading', text: 'About Aurora' }],
		},
		// A typo in the name and mostly empty: what the survivor takes when it has nothing.
		{
			name: 'Aurora Lightning GmbH',
			email: 'info@aurora.example',
			phone: { country: '+49', number: '30 7654321' },
		},
	]
	for (const data of docs) {
		await payload.create({
			collection: SHOWCASES,
			data: { ...data, tenant } as never,
			disableTransaction: true,
		})
	}
	payload.logger.info('Seeded dev custom-field showcases')
}
