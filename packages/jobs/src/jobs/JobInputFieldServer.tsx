import { RenderServerComponent } from '@payloadcms/ui/elements/RenderServerComponent'
import type { JSONFieldClient, Payload } from 'payload'
import type { ReactNode } from 'react'
import type { JobInputComponentProps, JobInputComponents } from './inputComponents'
import { renderedKey, resolveInputComponent } from './inputComponents'
import type { JobInputPlaceholders } from './inputPlaceholders'
import { JobInputField } from './JobInputField'

type Props = {
	clientField: JSONFieldClient
	components?: JobInputComponents
	path: string
	payload: Payload
	placeholders?: JobInputPlaceholders
	readOnly?: boolean
}

/**
 * Field component for a job's `input`. The import map is server-only, so the
 * custom editors are resolved and pre-rendered here, one per slug, and the
 * client field picks the one for the current selection.
 */
export const JobInputFieldServer = ({
	clientField,
	components,
	path,
	payload,
	placeholders,
	readOnly,
}: Props) => {
	const rendered: Record<string, ReactNode> = {}
	const render = (kind: JobInputComponentProps['kind'], slug: string) => {
		const Component = resolveInputComponent(components, slug)
		if (!Component) {
			return
		}
		const placeholder = kind === 'task' ? placeholders?.tasks[slug] : placeholders?.workflows[slug]
		const clientProps: JobInputComponentProps = { kind, path, placeholder, readOnly, slug }
		const node = RenderServerComponent({ clientProps, Component, importMap: payload.importMap })
		if (node != null) {
			rendered[renderedKey(kind, slug)] = node
		}
	}
	for (const task of payload.config.jobs?.tasks ?? []) render('task', task.slug)
	for (const workflow of payload.config.jobs?.workflows ?? []) render('workflow', workflow.slug)

	return (
		<JobInputField
			field={clientField}
			path={path}
			placeholders={placeholders}
			readOnly={readOnly}
			rendered={rendered}
		/>
	)
}
