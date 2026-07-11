import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '../../../../payload.config'
import { DemoForm } from '../../_components/DemoForm'

export const dynamic = 'force-dynamic'

export default async function FormPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params
	const payload = await getPayload({ config })
	const form = await payload.findByID({ collection: 'forms', id, depth: 0 }).catch(() => null)
	if (!form) notFound()
	return <DemoForm form={form}  />
}
