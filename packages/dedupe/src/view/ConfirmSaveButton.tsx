'use client'

import {
	ConfirmationModal,
	Pill,
	PublishButton,
	SaveButton,
	SaveDraftButton,
	useModal,
	useOperation,
} from '@payloadcms/ui'
import type { PublishButtonClientProps, SaveButtonClientProps } from 'payload'
import { type MouseEvent, type ReactNode, useId, useRef, useState } from 'react'

import './index.css'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { Signals } from './Signals'
import { type DuplicateCandidate, useDuplicateCheck } from './useDuplicateCheck'

/** The ids the admin gives its save, publish, publish-in-one-locale and save-draft buttons. */
const SAVE_BUTTONS = '#action-save, #action-save-draft, #publish-locale'

type ConfirmCreateProps = {
	children: ReactNode
	collection: string
	paths: string[]
}

/**
 * Stands in front of the admin's own save button: on a new document, a click is held
 * until the check answers, and a look-alike asks first. After a confirmation, or when
 * nothing resembles the values, the same click reaches the button, so everything the
 * button does itself (publish menus, the Cmd+S shortcut) stays the admin's. Updates pass
 * straight through, and a check that fails never stands in the way of a save.
 */
export function ConfirmCreate({ children, collection, paths }: ConfirmCreateProps) {
	const { t } = useTranslation()
	const operation = useOperation()
	const { isModalOpen, openModal } = useModal()
	// On a new document the check runs ahead, so the save asks without waiting; an update
	// passes straight through and needs none.
	const { check } = useDuplicateCheck({ collection, paths, follow: operation === 'create' })
	const modalSlug = `dedupe-confirm-create-${useId()}`
	const clicked = useRef<HTMLButtonElement | null>(null)
	const released = useRef(false)
	// A click held while the check is out; one made then, or while the question is open, is
	// swallowed, or a double click would save twice once both checks answer.
	const checking = useRef(false)
	const [matches, setMatches] = useState<DuplicateCandidate[]>([])

	const release = () => {
		released.current = true
		clicked.current?.click()
	}

	const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
		if (operation !== 'create') return
		const button = (event.target as HTMLElement).closest<HTMLButtonElement>(SAVE_BUTTONS)
		if (!button) return
		if (released.current) {
			released.current = false
			return
		}
		event.preventDefault()
		event.stopPropagation()
		if (checking.current || isModalOpen(modalSlug)) return
		checking.current = true
		clicked.current = button
		check()
			.then((found) => {
				checking.current = false
				if (found.length === 0) return release()
				setMatches(found)
				openModal(modalSlug)
			})
			.catch(() => {
				checking.current = false
				release()
			})
	}

	return (
		<div className="dedupe-confirm-create" onClickCapture={onClickCapture}>
			{children}
			<ConfirmationModal
				body={
					<div className="dedupe-duplicates">
						<p>{t(keys.confirmCreateBody)}</p>
						<ul className="dedupe-duplicates__list">
							{matches.map((candidate) => (
								<li className="dedupe-duplicates__item" key={candidate.id}>
									<div className="dedupe-duplicates__head">
										<strong>{candidate.title}</strong>
										<Pill size="small">{Math.round(candidate.score * 100)}%</Pill>
									</div>
									<Signals signals={candidate.signals} />
								</li>
							))}
						</ul>
					</div>
				}
				confirmLabel={t(keys.createAnyway)}
				heading={t(keys.confirmCreateHeading)}
				modalSlug={modalSlug}
				onConfirm={release}
			/>
		</div>
	)
}

type GuardProps = { collection: string; paths: string[] }

export function ConfirmSaveButton({
	collection,
	paths,
	...props
}: SaveButtonClientProps & GuardProps) {
	return (
		<ConfirmCreate collection={collection} paths={paths}>
			<SaveButton {...props} />
		</ConfirmCreate>
	)
}

export function ConfirmPublishButton({
	collection,
	paths,
	...props
}: PublishButtonClientProps & GuardProps) {
	return (
		<ConfirmCreate collection={collection} paths={paths}>
			<PublishButton {...props} />
		</ConfirmCreate>
	)
}

export function ConfirmSaveDraftButton({ collection, paths }: GuardProps) {
	return (
		<ConfirmCreate collection={collection} paths={paths}>
			<SaveDraftButton />
		</ConfirmCreate>
	)
}
