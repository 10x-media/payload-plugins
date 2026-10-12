import type { BeforeRemoveArgs, MergeSectionArgs } from '@10x-media/dedupe/types'
import type { CollectionSlug, PayloadRequest } from 'payload'

const MEMBERSHIPS = 'memberships' as CollectionSlug

/** The membership each club keeps, by club id, for the clubs more than one customer is in. */
export type MembershipChoice = Record<string, string>

type Membership = {
	id: number | string
	title: string
	customer: number | string
	club: number | string
}

/** The memberships of the merge's customers, by club. */
const byClub = async (
	req: PayloadRequest,
	ids: (number | string)[]
): Promise<Map<string, Membership[]>> => {
	const { docs } = await req.payload.find({
		collection: MEMBERSHIPS,
		where: { customer: { in: ids } },
		depth: 0,
		pagination: false,
		req,
	})
	const clubs = new Map<string, Membership[]>()
	for (const membership of docs as unknown as Membership[]) {
		const club = String(membership.club)
		clubs.set(club, [...(clubs.get(club) ?? []), membership])
	}
	return clubs
}

/** The membership a club keeps: its only one, or the one the reviewer picked. */
const keptOf = (members: Membership[], choice: Record<string, unknown>, club: string) =>
	members.length === 1
		? members[0]
		: members.find((member) => String(member.id) === String(choice[club]))

const choiceOf = (value: unknown): Record<string, unknown> =>
	value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

/**
 * Dev stand only: the section's `validate`. One membership per customer and club, so a club
 * two of them are in needs the reviewer to say which membership the survivor keeps; the
 * answer comes from the browser and is checked against the database.
 */
export const validateMemberships = async ({
	req,
	survivorId,
	absorbedIds,
	value,
}: MergeSectionArgs): Promise<string | null> => {
	const choice = choiceOf(value)
	for (const [club, members] of await byClub(req, [survivorId, ...absorbedIds])) {
		if (!keptOf(members, choice, club)) {
			return `Pick the membership the customer keeps in club ${club}.`
		}
	}
	return null
}

/**
 * Dev stand only: what `hooks.beforeRemove` does with the section's value. In each club the
 * membership kept goes to the survivor and the others are deleted, first, so the unique index
 * over customer and club never holds two.
 */
export const moveMemberships = async ({
	req,
	survivorId,
	absorbedIds,
	sections,
}: BeforeRemoveArgs): Promise<void> => {
	const choice = choiceOf(sections.memberships)
	for (const [club, members] of await byClub(req, [survivorId, ...absorbedIds])) {
		const kept = keptOf(members, choice, club)
		if (!kept) throw new Error(`No membership picked for club ${club}`)
		for (const member of members) {
			if (member.id === kept.id) continue
			await req.payload.delete({ collection: MEMBERSHIPS, id: member.id, depth: 0, req })
		}
		if (String(kept.customer) !== String(survivorId)) {
			await req.payload.update({
				collection: MEMBERSHIPS,
				id: kept.id,
				data: { customer: survivorId },
				depth: 0,
				req,
			})
		}
	}
}
