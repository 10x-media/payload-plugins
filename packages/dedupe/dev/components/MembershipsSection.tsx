'use client'

import { MergeCell, MergePick, MergeRow, useMergeSection } from '@10x-media/dedupe/client'
import { useConfig } from '@payloadcms/ui'
import { useEffect, useState } from 'react'

import type { MembershipChoice } from '../helpers/memberships'

type Membership = {
	id: number | string
	title: string
	customer: number | string | { id: number | string }
	club: number | string | { id: number | string; name?: string }
}

const idOf = (value: Membership['customer'] | Membership['club']) =>
	String(typeof value === 'object' ? value.id : value)

/**
 * Dev stand only: the customers' merge section. A club row for every club the customers are
 * in. A club only one of them is in moves along and is shown kept; a club two of them are
 * in needs a pick, and keeps the merge from applying until it has one.
 */
export const MembershipsSection = () => {
	const { docs, value, setValue, setReady } = useMergeSection<MembershipChoice>()
	const {
		config: {
			routes: { api },
		},
	} = useConfig()
	const [memberships, setMemberships] = useState<Membership[] | null>(null)
	const ids = docs.map((doc) => doc.id).join(',')

	useEffect(() => {
		const query = new URLSearchParams({ 'where[customer][in]': ids, depth: '1', limit: '0' })
		let current = true
		fetch(`${api}/memberships?${query}`, { credentials: 'include' })
			.then((response) => response.json())
			.then((json: { docs?: Membership[] }) => current && setMemberships(json.docs ?? []))
			.catch(() => current && setMemberships([]))
		return () => {
			current = false
		}
	}, [api, ids])

	const clubs = new Map<string, Membership[]>()
	for (const membership of memberships ?? []) {
		const club = idOf(membership.club)
		clubs.set(club, [...(clubs.get(club) ?? []), membership])
	}
	const open = [...clubs].filter(([club, members]) => members.length > 1 && !value?.[club])

	// Not ready while the memberships load, nor while a shared club waits for a pick.
	useEffect(() => {
		setReady(memberships !== null && open.length === 0)
	}, [memberships, open.length, setReady])

	return [...clubs].map(([club, members]) => {
		const first = members[0] as Membership
		const name = typeof first.club === 'object' ? (first.club.name ?? club) : club
		return (
			<MergeRow
				cell={(doc) => {
					const member = members.find((entry) => idOf(entry.customer) === doc.id)
					if (!member) return <MergeCell />
					// Alone in its club, it moves to the survivor: shown kept, with nothing to pick.
					const alone = members.length === 1
					return (
						<MergePick
							checked={alone || value?.[club] === String(member.id)}
							id={`membership-${club}-${doc.id}`}
							label={doc.title}
							name={`membership-${club}`}
							onChange={() => setValue((current) => ({ ...current, [club]: String(member.id) }))}
							readOnly={alone}
						>
							{member.title}
						</MergePick>
					)
				}}
				key={club}
				label={`Membership: ${name}`}
				needsChoice={open.some(([entry]) => entry === club)}
			/>
		)
	})
}
