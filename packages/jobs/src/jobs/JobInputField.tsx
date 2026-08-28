'use client'

import { JSONField, useDocumentInfo, useField, useFormFields } from '@payloadcms/ui'
import type { JSONFieldClientProps } from 'payload'
import type { FC, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

import { renderedKey } from '../plugin/inputComponents'
import type { JobInputPlaceholders } from '../plugin/inputPlaceholders'

type JobInputFieldProps = JSONFieldClientProps & {
	placeholders?: JobInputPlaceholders
	/** Custom editors pre-rendered by `JobInputFieldServer`, keyed by `renderedKey`. */
	rendered?: Record<string, ReactNode>
}

/** Nothing worth keeping: unset, blank, or an object with no keys. */
const isBlank = (value: unknown): boolean =>
	value == null ||
	value === '' ||
	(typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)

const slugOf = (value: unknown): string | undefined =>
	typeof value === 'string' && value ? value : undefined

/**
 * The job's `input` editor. On Create every task and workflow gets its own
 * draft: picking one shows what the editor last left there, or its placeholder
 * from `inputSchema` (or `input.examples`) the first time, so work on one task
 * never leaks into another and never gets lost by switching. Clearing the
 * selection empties the field. A slug with a custom editor shows that instead
 * of the JSON field; both read and write the same form value, so the draft
 * lands in either. Existing jobs are left alone: their inputs are read-only.
 */
export const JobInputField: FC<JobInputFieldProps> = (props) => {
	const { path, placeholders, rendered, ...fieldProps } = props
	const { id } = useDocumentInfo()
	const { setValue, value } = useField<unknown>({ path })
	const taskSlug = useFormFields(([fields]) => slugOf(fields?.taskSlug?.value))
	const workflowSlug = useFormFields(([fields]) => slugOf(fields?.workflowSlug?.value))
	const selected = taskSlug
		? renderedKey('task', taskSlug)
		: workflowSlug
			? renderedKey('workflow', workflowSlug)
			: undefined
	const placeholder = taskSlug
		? placeholders?.tasks[taskSlug]
		: workflowSlug
			? placeholders?.workflows[workflowSlug]
			: undefined
	// What the editor left in the field for each slug shown so far, and which
	// slug the field currently shows.
	const drafts = useRef(new Map<string, unknown>())
	const shown = useRef<string | undefined>(undefined)
	const valueRef = useRef(value)
	valueRef.current = value
	// Bumped on every clear. JSONField only pushes a form-state change into Monaco
	// when it serializes to a string, and a cleared value serializes to nothing, so
	// the editor would keep showing the old text; remounting it is what empties it.
	const [epoch, setEpoch] = useState(0)

	useEffect(() => {
		if (id || selected === shown.current) return
		if (shown.current !== undefined) drafts.current.set(shown.current, valueRef.current)
		shown.current = selected
		if (selected === undefined) {
			setValue(null)
			setEpoch((current) => current + 1)
			return
		}
		const draft = drafts.current.get(selected)
		const next = isBlank(draft) ? placeholder : draft
		if (next !== undefined) setValue(next)
	}, [id, selected, placeholder, setValue])

	const custom = selected ? rendered?.[selected] : undefined
	return custom ?? <JSONField key={epoch} path={path} {...fieldProps} />
}
