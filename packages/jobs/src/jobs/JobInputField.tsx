'use client'

import { JSONField, useDocumentInfo, useField, useForm, useFormFields } from '@payloadcms/ui'
import type { JSONFieldClientProps } from 'payload'
import type { FC, ReactNode } from 'react'
import { useEffect, useRef } from 'react'

import { hasKeys } from './hasKeys'
import { renderedKey } from './inputComponents'
import type { JobInputPlaceholders } from './inputPlaceholders'

type JobInputFieldProps = JSONFieldClientProps & {
	placeholders?: JobInputPlaceholders
	/** Custom editors pre-rendered by `JobInputFieldServer`, keyed by `renderedKey`. */
	rendered?: Record<string, ReactNode>
}

const slugOf = (value: unknown): string | undefined =>
	typeof value === 'string' && value ? value : undefined

/**
 * The job's `input` editor. On Create each task and workflow slug keeps its own
 * draft while the form is open; a custom editor and the JSON field share the
 * same form value. Existing jobs are never touched.
 */
export const JobInputField: FC<JobInputFieldProps> = (props) => {
	const { path, placeholders, rendered, ...fieldProps } = props
	const { id } = useDocumentInfo()
	const { getDataByPath } = useForm()
	const { setValue } = useField<unknown>({ path })
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
	const drafts = useRef(new Map<string, Record<string, unknown>>())
	const shown = useRef<string | undefined>(undefined)

	useEffect(() => {
		if (id || selected === shown.current) return
		if (shown.current !== undefined) {
			// The JSON editor parks unparsable text as a string, which would not
			// survive a round trip through form state; an empty object is no draft.
			const parked = getDataByPath(path)
			if (hasKeys(parked)) drafts.current.set(shown.current, parked)
			else drafts.current.delete(shown.current)
		}
		shown.current = selected
		if (selected === undefined) {
			setValue({})
			return
		}
		setValue(drafts.current.get(selected) ?? placeholder ?? {})
	}, [id, selected, placeholder, setValue, getDataByPath, path])

	const custom = selected ? rendered?.[selected] : undefined
	return custom ?? <JSONField path={path} {...fieldProps} />
}
