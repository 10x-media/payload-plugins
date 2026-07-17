import { resolveEffectivePollOptions } from '@10x-media/form-builder/rsc'
import { createLocalReq, getPayload } from 'payload'
import config from '../../../payload.config'
import { AthletePoll } from '../_components/AthletePoll'

export const dynamic = 'force-dynamic'

export default async function AthletePollPage() {
	const payload = await getPayload({ config })
	const { docs } = await payload.find({
		collection: 'forms',
		where: { title: { equals: 'Who will win?' } },
		limit: 1,
		depth: 0,
	})
	const form = docs[0]
	if (!form) {
		return <p>Poll not seeded.</p>
	}
	// The athleteVote field stores only the ids of the voteable athletes; the choices a visitor sees
	// are resolved here from the field's own `resolveOptions` (the four athletes the author picked)
	// and injected onto the field by `toFormDocument({ pollOptions })` in the client wrapper.
	const req = await createLocalReq({}, payload)
	const pollOptions = await resolveEffectivePollOptions({ payload, req, form })
	return <AthletePoll form={form} pollOptions={pollOptions} />
}
