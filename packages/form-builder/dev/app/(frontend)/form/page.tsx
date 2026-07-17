import { resolveConsentStatements } from '@10x-media/form-builder/rsc'
import { createLocalReq, getPayload } from 'payload'
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
	// The form stores only a source key per consent field; the statement the visitor reads is
	// resolved here, for this request's locale, from whatever the source says right now.
	// `createLocalReq` is what gives the host resolver a real `req` outside a route handler.
	const req = await createLocalReq({}, payload)
	const consentStatements = await resolveConsentStatements({ payload, req, form })
	return <DemoForm form={form} consentStatements={consentStatements} />
}
