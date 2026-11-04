'use client'

import { DateTimeField, useDocumentInfo } from '@payloadcms/ui'
import type { DateFieldClientProps } from 'payload'
import type { FC } from 'react'

import { ReadOnlyDateField } from './ReadOnlyDateField'

/**
 * Scheduling input: the native datetime picker while creating, the read-only
 * relative display once the job exists (the runner owns the value after that).
 */
export const WaitUntilField: FC<DateFieldClientProps> = (props) => {
	const { id } = useDocumentInfo()
	return id ? <ReadOnlyDateField {...props} /> : <DateTimeField {...props} />
}
