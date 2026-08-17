'use client'

import { useFieldPath, useFormFields } from '@payloadcms/ui'
import React from 'react'

import { chosenUploadIds, packChosenIds, unpackChosenIds } from './chosenUploadIds'

/**
 * The ids the upload field already holds, for one collection.
 *
 * Payload's upload field appends whatever the drawer hands it, in both paths: `onSelect`
 * for a double click and `onBulkSelect` for the selection pill. Neither checks what is
 * already there, so picking a file a second time stores it twice. On the list tab that
 * never comes up, because the field hides what it holds through `filterOptions`. The
 * drawer is rendered inside the field, so the same value is reachable from here and the
 * folder tab can hide the same files.
 *
 * `useFieldPath` is marked experimental upstream. If it ever stops resolving, the set comes
 * back empty and the folder tab lists everything, as it did before.
 */
export const useChosenUploads = (collectionSlug: string): Set<string> => {
	const path = useFieldPath()

	const packed = useFormFields(([fields]) =>
		packChosenIds(chosenUploadIds(path ? fields?.[path]?.value : undefined, collectionSlug))
	)

	return React.useMemo(() => new Set(packed ? unpackChosenIds(packed) : []), [packed])
}
