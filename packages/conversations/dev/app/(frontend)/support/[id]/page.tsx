import { getInstance } from '@10x-media/conversations'
import config from '@payload-config'
import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'

import { LoginForm } from '../_components/LoginForm'
import { SupportChat } from '../_components/SupportChat'

/** Per request: it reads the session. */
export const dynamic = 'force-dynamic'

/** Website demo: one ticket's conversation, for the customer who owns it. */
export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params
	const payload = await getPayload({ config })
	const { user } = await payload.auth({ headers: await headers() })
	if (user?.collection !== 'customers') return <LoginForm />
	const ticket = await payload
		.findByID({ collection: 'tickets', depth: 0, disableErrors: true, id })
		.catch(() => null)
	if (!ticket || String(ticket.customer) !== String(user.id)) notFound()
	return (
		<main className="mx-auto max-w-2xl p-6">
			<Link className="text-muted-foreground text-sm hover:underline" href="/support">
				← All tickets
			</Link>
			<div className="mt-4">
				<SupportChat
					subject={ticket.subject}
					ticketId={String(ticket.id)}
					transport={getInstance({ payload }, 'tickets').transport?.client}
				/>
			</div>
		</main>
	)
}
