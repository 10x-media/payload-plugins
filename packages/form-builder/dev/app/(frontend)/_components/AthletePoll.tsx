'use client'

import { Poll, type ToFormDocumentOptions, toFormDocument } from '@10x-media/form-builder/react'
import { athleteVoteRenderer } from './AthleteVoteField'

/**
 * Renders the relationship-backed poll. `pollOptions` are the voteable athletes resolved on the
 * server (page.tsx) and injected onto the `athleteVote` field; the custom `athleteVote` renderer
 * turns them into the voting UI. Results come back labeled with athlete names, aggregated and
 * labeled server-side from the same `resolveOptions`, so the client stays option-agnostic.
 */
export function AthletePoll({
	form,
	pollOptions,
}: {
	form: Parameters<typeof toFormDocument>[0]
	pollOptions?: ToFormDocumentOptions['pollOptions']
}) {
	return (
		<main style={{ maxWidth: 640, margin: '2rem auto', padding: '0 1rem' }}>
			<h1>Who will win?</h1>
			<Poll
				form={toFormDocument(form, { pollOptions })}
				resultsField="pick"
				renderers={{ athleteVote: athleteVoteRenderer }}
			/>
		</main>
	)
}
