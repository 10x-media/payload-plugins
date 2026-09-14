'use client'

import { useWizard, useWizardState } from '@10x-media/form-variants/client'
import { useConfig, useDocumentInfo, useFormFields } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import type React from 'react'
import { useCallback, useEffect, useState } from 'react'

import './dev.css'

type Match = { firstName: string; id: string; lastName: string }

/**
 * A component step from the worked example: searches for people with the same name. It draws
 * only its content and drives the wizard's own footer: saving stays blocked while it searches,
 * no match leaves the footer's Save as is, and a match swaps the primary button for "Request
 * creation from an admin", which ends the wizard without saving.
 */
export const DuplicateCheckStep: React.FC = () => {
	const { allowSave, blockSave, finish, setMessage, setPrimaryAction } = useWizard()
	const { id } = useDocumentInfo()
	const {
		config: {
			routes: { admin, api },
			serverURL,
		},
	} = useConfig()
	const firstName = useFormFields(([fields]) => fields.firstName?.value as string | undefined)
	const lastName = useFormFields(([fields]) => fields.lastName?.value as string | undefined)
	const [matches, setMatches] = useState<Match[] | null>(null)
	const [, setChecked] = useWizardState<boolean>('duplicateCheckPassed')
	const name = `${firstName ?? ''} ${lastName ?? ''}`.trim()

	const search = useCallback(async () => {
		const params = new URLSearchParams({
			depth: '0',
			limit: '5',
			'where[firstName][equals]': firstName ?? '',
			'where[lastName][equals]': lastName ?? '',
		})
		const response = await fetch(`${serverURL}${api}/people?${params}`, { credentials: 'include' })
		const json = (await response.json()) as { docs: Match[] }
		const found = json.docs.filter((doc) => doc.id !== id)
		setMatches(found)
		setChecked(found.length === 0)
	}, [api, firstName, id, lastName, serverURL, setChecked])

	useEffect(() => {
		void search()
	}, [search])

	useEffect(() => {
		if (matches === null) {
			blockSave('Checking for duplicates…')
			return
		}
		if (matches.length === 0) {
			allowSave()
			return
		}
		blockSave('A person with this name already exists.')
		setMessage(
			matches.length === 1
				? 'One person with this name already exists.'
				: `${matches.length} people with this name already exist.`
		)
		setPrimaryAction({
			label: 'Request creation from an admin',
			onClick: () =>
				finish({
					matches: matches.map((match) => match.id),
					message: 'An admin has been asked to review the possible duplicate.',
					title: 'Request sent',
				}),
		})
	}, [allowSave, blockSave, finish, matches, setMessage, setPrimaryAction])

	useEffect(() => allowSave, [allowSave])

	if (matches === null) {
		return <p className="dev-muted">Searching for people named {name}…</p>
	}

	if (matches.length === 0) {
		return <p>No one else is called {name}. Save to create the person.</p>
	}

	return (
		<div className="dev-stack">
			<p>These people already have the same name:</p>
			<ul className="dev-list">
				{matches.map((match) => (
					<li key={match.id}>
						<a
							href={formatAdminURL({ adminRoute: admin, path: `/collections/people/${match.id}` })}
							rel="noreferrer"
							target="_blank"
						>
							{match.firstName} {match.lastName}
						</a>
						<span className="dev-muted">#{match.id}</span>
					</li>
				))}
			</ul>
			<p className="dev-muted">
				If this really is a new person, ask an admin to create the record.
			</p>
		</div>
	)
}
