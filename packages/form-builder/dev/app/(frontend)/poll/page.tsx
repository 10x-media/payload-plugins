import { getPayload } from 'payload'
import config from '../../../payload.config'
import { DemoPoll } from '../_components/DemoPoll'

export const dynamic = 'force-dynamic'

export default async function PollPage() {
	const payload = await getPayload({ config })
	const { docs } = await payload.find({
		collection: 'forms',
		where: { title: { equals: 'Favorite framework' } },
		limit: 1,
		depth: 0,
	})
	const form = docs[0]
	if (!form) {
		return <p>Poll not seeded.</p>
	}
	return <DemoPoll form={form} />
}
