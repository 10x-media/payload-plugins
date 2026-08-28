import { RenderServerComponent } from '@payloadcms/ui/elements/RenderServerComponent'
import type { JSONFieldClient, Payload } from 'payload'
import type { ReactNode } from 'react'

import type { JobInputComponentProps, JobInputComponents } from '../plugin/inputComponents'
import { renderedKey, resolveInputComponent } from '../plugin/inputComponents'
import type { JobInputPlaceholders } from '../plugin/inputPlaceholders'
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
 * Field component for a job's `input`. Resolves the configured custom editors
 * against the import map and pre-renders one per task and workflow slug they
 * cover, then hands them to the client field, which shows the one matching the
 * selected slug and falls back to the JSON editor for every other.
 *
 * The resolve has to happen here because the import map is server-only. The
 * editors themselves are client components: they write to the form.
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
	const kinds: [JobInputComponentProps['kind'], Record<string, Record<string, unknown>>][] = [
		['task', placeholders?.tasks ?? {}],
		['workflow', placeholders?.workflows ?? {}],
	]
	for (const [kind, bySlug] of kinds) {
		for (const [slug, placeholder] of Object.entries(bySlug)) {
			const Component = resolveInputComponent(components, slug)
			if (!Component) {
				continue
			}
			const clientProps: JobInputComponentProps = { kind, path, placeholder, readOnly, slug }
			const node = RenderServerComponent({
				clientProps,
				Component,
				importMap: payload.importMap,
			})
			if (node != null) {
				rendered[renderedKey(kind, slug)] = node
			}
		}
	}

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
