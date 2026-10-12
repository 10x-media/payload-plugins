import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { RenderServerComponent } from '@payloadcms/ui/elements/RenderServerComponent'
import type { Config, ImportMap } from 'payload'
import { createElement, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { goalField } from '../goals/goalField'
import { analytics } from '../index'
import { memoryAdapter } from '../testing/memoryAdapter'

type NestProvidersComponent = (args: {
	children?: ReactNode
	importMap: ImportMap
	providers: NonNullable<NonNullable<Config['admin']>['components']>['providers']
	serverProps: object
}) => ReactNode

/**
 * Payload's own `NestProviders`, which renders nothing under a provider its import map lacks. Not a
 * public export, so it is loaded from the installed package.
 */
const loadNestProviders = async (): Promise<NestProvidersComponent> => {
	const layouts = createRequire(import.meta.url).resolve('@payloadcms/next/layouts')
	const loaded: { NestProviders: NestProvidersComponent } = await import(
		join(dirname(layouts), '..', 'layouts', 'Root', 'NestProviders.js')
	)
	return loaded.NestProviders
}

const HOST_PROVIDER = '/components/HostProvider#HostProvider'

const HostProvider = ({ children }: { children?: ReactNode }) =>
	createElement('div', { 'data-host-provider': '' }, children)

/** A host on a plugin upgrade it never regenerated the import map for: only its own entries. */
const staleImportMap: ImportMap = { [HOST_PROVIDER]: HostProvider }

const hostConfig = (): Config =>
	({
		collections: [{ slug: 'campaigns', fields: [goalField()] }],
		admin: { components: { providers: [HOST_PROVIDER] } },
	}) as unknown as Config

/** Two sources, so the widgets' drawers carry a data source picker too. */
const plugin = () =>
	analytics({ adapters: [memoryAdapter(), { ...memoryAdapter(), id: 'second' }] })

const analyticsPaths = (config: Config): string[] => [
	...new Set(JSON.stringify(config).match(/@10x-media\/analytics\/(rsc|client)#[A-Za-z]+/g) ?? []),
]

describe('an admin whose import map predates the plugin', () => {
	it('still renders its root: the plugin wraps nothing around the admin', async () => {
		const config = await plugin()(hostConfig())
		const NestProviders = await loadNestProviders()
		const html = renderToString(
			createElement(
				NestProviders,
				{
					importMap: staleImportMap,
					providers: config.admin?.components?.providers ?? [],
					serverProps: {},
				},
				createElement('main', { id: 'admin-root' }, 'Dashboard')
			)
		)
		expect(html).toContain('data-host-provider')
		expect(html).toContain('id="admin-root"')
	})

	// Payload offers no fallback for a field component (ui/src/forms/fieldSchemasToFormState/
	// renderField.tsx:252-264): a field it cannot find renders nothing, and only that field.
	it('loses only the analytics fields and widgets it lacks, each on its own', async () => {
		const config = await plugin()(hostConfig())
		const paths = analyticsPaths(config)
		expect(paths).toEqual(
			expect.arrayContaining([
				'@10x-media/analytics/rsc#GoalSelectFieldServer',
				'@10x-media/analytics/rsc#SourceSelectFieldServer',
				'@10x-media/analytics/rsc#MetricSelectFieldServer',
				'@10x-media/analytics/rsc#FilterValueFieldServer',
			])
		)
		const form = createElement(
			'form',
			null,
			createElement('input', { name: 'title' }),
			...paths.map((path) =>
				RenderServerComponent({ Component: path, importMap: staleImportMap, key: path })
			)
		)
		expect(renderToString(form)).toBe('<form><input name="title"/></form>')
	})
})
