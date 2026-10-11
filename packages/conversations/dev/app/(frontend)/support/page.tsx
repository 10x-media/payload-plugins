import config from '@payload-config'
import { headers } from 'next/headers'
import Link from 'next/link'
import { getPayload } from 'payload'

import { LoginForm, LogoutButton } from './_components/LoginForm'

/** Per request: it reads the session. */
export const dynamic = 'force-dynamic'

/** Website demo: a customer's support tickets. */
export default async function SupportPage() {
	const payload = await getPayload({ config })
	const { user } = await payload.auth({ headers: await headers() })
	if (user?.collection !== 'customers') return <LoginForm />
	const tickets = await payload.find({
		collection: 'tickets',
		depth: 0,
		sort: '-createdAt',
		where: { customer: { equals: user.id } },
	})
	return (
		<main className="mx-auto max-w-2xl p-6">
			<div className="mb-6 flex items-center justify-between">
				<h1 className="font-semibold text-xl">Your tickets</h1>
				<LogoutButton />
			</div>
			<ul className="divide-y rounded-xl border">
				{tickets.docs.map((ticket) => (
					<li key={ticket.id}>
						<Link
							className="flex items-center justify-between p-4 hover:bg-muted/50"
							href={`/support/${ticket.id}`}
						>
							<span>{ticket.subject}</span>
							<span className="text-muted-foreground text-xs">{ticket.status}</span>
						</Link>
					</li>
				))}
			</ul>
		</main>
	)
}
