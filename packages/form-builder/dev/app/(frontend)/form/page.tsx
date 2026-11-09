import { getPayload } from 'payload'
import { DemoForm } from '../../../demo/DemoForm'
import { loadFormDemo } from '../../../demo/data'
import config from '../../../payload.config'

export const dynamic = 'force-dynamic'

export default async function FormPage() {
	const data = await loadFormDemo(await getPayload({ config }))
	if (!data) {
		return <p>Demo form not seeded.</p>
	}
	return <DemoForm form={data.form} consentStatements={data.consentStatements} />
}
