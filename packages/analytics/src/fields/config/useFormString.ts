'use client'

import { useFormFields } from '@payloadcms/ui'

/** A form field's value where it holds text, the way a picker reads the fields it narrows by. */
export const useFormString = (path: string): string | undefined =>
	useFormFields(([fields]) => {
		const value = fields?.[path]?.value
		return typeof value === 'string' ? value : undefined
	})
