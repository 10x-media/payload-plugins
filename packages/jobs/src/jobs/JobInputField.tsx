'use client'

import { JSONField, useDocumentInfo, useField, useFormFields } from '@payloadcms/ui'
import type { JSONFieldClientProps } from 'payload'
import type { FC } from 'react'
import { useEffect, useRef, useState } from 'react'

import type { JobInputPlaceholders } from '../plugin/inputPlaceholders'

type JobInputFieldProps = JSONFieldClientProps & { placeholders?: JobInputPlaceholders }

const serialize = (value: unknown): string => JSON.stringify(value ?? null)

/** Nothing worth keeping: unset, blank, or an object with no keys. */
const isBlank = (value: unknown): boolean =>
	value == null ||
	value === '' ||
	(typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)

const slugOf = (value: unknown): string | undefined =>
	typeof value === 'string' && value ? value : undefined

/**
 * The job's `input` editor, pre-filled from the selected task's or workflow's
 * `inputSchema` on Create. The placeholder is written only while the field is
 * blank or still holds the placeholder this component put there, so a value the
 * editor typed survives switching tasks; clearing the selection empties the
 * field under the same rule. Existing jobs are left to the plain JSON field:
 * their inputs are read-only anyway.
 */
export const JobInputField: FC<JobInputFieldProps> = (props) => {
	const { path, placeholders } = props
	const { id } = useDocumentInfo()
	const { setValue, value } = useField<unknown>({ path })
	const taskSlug = useFormFields(([fields]) => slugOf(fields?.taskSlug?.value))
	const workflowSlug = useFormFields(([fields]) => slugOf(fields?.workflowSlug?.value))
	// Serialized form of the last placeholder written here; compared against the
	// current value to tell "still the placeholder" from "the editor's own input".
	const placed = useRef<string | undefined>(undefined)
	const valueRef = useRef(value)
	valueRef.current = value
	// Bumped on every clear. JSONField only pushes a form-state change into Monaco
	// when it serializes to a string, and a cleared value serializes to nothing, so
	// the editor would keep showing the old text; remounting it is what empties it.
	const [epoch, setEpoch] = useState(0)

	useEffect(() => {
		if (id) return
		const current = serialize(valueRef.current)
		if (!isBlank(valueRef.current) && current !== placed.current) return
		if (!taskSlug && !workflowSlug) {
			if (placed.current !== undefined) {
				setValue(null)
				placed.current = undefined
				setEpoch((current) => current + 1)
			}
			return
		}
		const next = taskSlug
			? placeholders?.tasks[taskSlug]
			: workflowSlug
				? placeholders?.workflows[workflowSlug]
				: undefined
		if (next === undefined) return
		const replacement = serialize(next)
		if (current !== replacement) setValue(next)
		placed.current = replacement
	}, [id, taskSlug, workflowSlug, placeholders, setValue])

	return <JSONField key={epoch} {...props} />
}
