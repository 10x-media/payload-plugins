'use client'

import { type DuplicateCandidate, useDuplicateCheck } from '@10x-media/dedupe/client'
import { useWizard } from '@10x-media/form-variants/client'
import { useConfig } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import { useEffect, useState } from 'react'

/** Born on the same day as a look-alike: the same person rather than a namesake. */
const isStrong = (candidate: DuplicateCandidate) =>
	candidate.signals.some((signal) => signal.path === 'birthDate' && signal.kind === 'match')

/**
 * The guided create form's last step: asks the dedupe check about the values typed so far. A
 * strong match blocks the save, weaker ones are listed with a warning and the save stays open.
 */
export const DuplicateCheckStep = () => {
	const { allowSave, blockSave, setMessage } = useWizard()
	const {
		config: {
			routes: { admin },
		},
	} = useConfig()
	const { check } = useDuplicateCheck({
		collection: 'customers',
		paths: ['email', 'name', 'phone', 'birthDate'],
		follow: false,
	})
	const [found, setFound] = useState<DuplicateCandidate[] | Error | null>(null)

	useEffect(() => {
		let current = true
		check().then(
			(candidates) => current && setFound(candidates),
			(error: Error) => current && setFound(error)
		)
		return () => {
			current = false
		}
	}, [check])

	useEffect(() => {
		if (found === null) blockSave('Checking for duplicates…')
		else if (found instanceof Error) blockSave(found.message)
		else if (found.some(isStrong)) blockSave('This customer already exists.')
		else {
			allowSave()
			if (found.length > 0) setMessage('Similar customers exist. Check them before saving.')
		}
	}, [allowSave, blockSave, found, setMessage])

	useEffect(() => allowSave, [allowSave])

	if (found === null) return <p>Checking for duplicates…</p>
	if (found instanceof Error) return <p>{found.message}</p>
	if (found.length === 0) return <p>No similar customers. Save to create this one.</p>
	return (
		<ul>
			{found.map((candidate) => {
				const same = candidate.signals
					.filter((signal) => signal.kind === 'match')
					.map((signal) => signal.label)
				return (
					<li key={candidate.id}>
						<a
							href={formatAdminURL({
								adminRoute: admin,
								path: `/collections/customers/${candidate.id}`,
							})}
							rel="noreferrer"
							target="_blank"
						>
							{candidate.title}
						</a>{' '}
						{Math.round(candidate.score * 100)}%{same.length ? `, same ${same.join(', ')}` : ''}
					</li>
				)
			})}
		</ul>
	)
}
