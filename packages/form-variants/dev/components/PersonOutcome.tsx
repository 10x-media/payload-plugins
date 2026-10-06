'use client'

import { useFormVariants, useOutcome } from '@10x-media/form-variants/client'
import { Button, useConfig, useDocumentDrawerContext, useModal } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import type React from 'react'

import './dev.css'

/**
 * The dev app's `Outcome` slot for the quick form: the plugin hands over the data and the
 * surface, and the consumer decides what comes next. On the page that is creating another
 * person or going back to the list; in a drawer there is nowhere to go but closed.
 */
export const PersonOutcome: React.FC = () => {
	const outcome = useOutcome()
	const { inDrawer } = useFormVariants()
	const { drawerSlug } = useDocumentDrawerContext()
	const { closeModal } = useModal()
	const {
		config: {
			routes: { admin },
		},
	} = useConfig()
	if (!outcome) {
		return null
	}

	return (
		<section className="dev-outcome">
			<h2>{typeof outcome.title === 'string' ? outcome.title : 'Done'}</h2>
			{typeof outcome.message === 'string' && <p>{outcome.message}</p>}
			<div className="dev-outcome__actions">
				{inDrawer ? (
					<Button buttonStyle="primary" onClick={() => closeModal(drawerSlug)} size="medium">
						Close
					</Button>
				) : (
					<>
						{/* A full load, so the create view starts over instead of keeping this outcome. */}
						<Button
							buttonStyle="primary"
							el="anchor"
							size="medium"
							url={formatAdminURL({ adminRoute: admin, path: '/collections/people/create' })}
						>
							Add another person
						</Button>
						<Button
							buttonStyle="secondary"
							el="link"
							size="medium"
							to={formatAdminURL({ adminRoute: admin, path: '/collections/people' })}
						>
							Back to people
						</Button>
					</>
				)}
			</div>
		</section>
	)
}
