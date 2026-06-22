import { getPayload } from 'payload'
import config from '../../../payload.config'
import { DemoForm } from '../_components/DemoForm'

export const dynamic = 'force-dynamic'

export default async function FormPage() {
	const payload = await getPayload({ config })
	const { docs } = await payload.find({
		collection: 'forms',
		where: { title: { equals: 'Demo Contact' } },
		limit: 1,
		depth: 0,
	})
	const form = docs[0]
	if (!form) {
		return <p>Demo form not seeded.</p>
	}
	return <DemoForm form={form} />
}
