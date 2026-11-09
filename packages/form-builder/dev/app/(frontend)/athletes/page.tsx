import { getPayload } from 'payload'
import { AthletePoll } from '../../../demo/AthletePoll'
import { loadAthletesDemo } from '../../../demo/data'
import config from '../../../payload.config'

export const dynamic = 'force-dynamic'

export default async function AthletePollPage() {
	const data = await loadAthletesDemo(await getPayload({ config }))
	if (!data) {
		return <p>Poll not seeded.</p>
	}
	return <AthletePoll form={data.form} pollOptions={data.pollOptions} />
}
