import { getPayload } from 'payload'
import { DemoPoll } from '../../../demo/DemoPoll'
import { loadPollDemo } from '../../../demo/data'
import config from '../../../payload.config'

export const dynamic = 'force-dynamic'

export default async function PollPage() {
	const data = await loadPollDemo(await getPayload({ config }))
	if (!data) {
		return <p>Poll not seeded.</p>
	}
	return <DemoPoll form={data.form} />
}
