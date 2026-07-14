import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '../../../../payload.config'
import { DemoPoll } from '../../_components/DemoPoll'

export const dynamic = 'force-dynamic'

export default async function PollPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params
	const payload = await getPayload({ config })
	const form = await payload.findByID({ collection: 'forms', id, depth: 0 }).catch(() => null)
	if (!form) notFound()
	return <DemoPoll form={form} />
}
