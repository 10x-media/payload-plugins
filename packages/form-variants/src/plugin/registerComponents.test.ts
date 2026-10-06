import type { CollectionSlug } from 'payload'
import { describe, expect, it } from 'vitest'

import type { FormVariantsConfig } from '../types'
import { collectDependencies, withVariantView } from './registerComponents'
import { resolveCollection } from './resolveConfig'

const resolve = (config: FormVariantsConfig<CollectionSlug>) => ({
	people: resolveCollection('people', config),
})

const paths = (dependencies: ReturnType<typeof collectDependencies>): string[] =>
	Object.values(dependencies).map((entry) => entry.path)

describe('collectDependencies', () => {
	it('registers the edit view itself', () => {
		expect(paths(collectDependencies({}, undefined))).toContain(
			'@10x-media/form-variants/rsc#VariantEditView'
		)
	})

	it('registers component steps and slots at every level', () => {
		const dependencies = collectDependencies(
			resolve({
				components: { Layout: './CollectionLayout#CollectionLayout' },
				variants: [
					{
						components: { Outcome: './VariantOutcome#VariantOutcome' },
						key: 'quick',
						steps: [
							{
								components: { Navigation: './StepNav#StepNav' },
								Component: './Duplicates#Duplicates',
								key: 'check',
							},
						],
					},
				],
			}),
			{ Progress: './PluginProgress#PluginProgress' }
		)

		expect(paths(dependencies)).toEqual(
			expect.arrayContaining([
				'./CollectionLayout#CollectionLayout',
				'./Duplicates#Duplicates',
				'./PluginProgress#PluginProgress',
				'./StepNav#StepNav',
				'./VariantOutcome#VariantOutcome',
			])
		)
	})

	it('registers component items nested in a step container', () => {
		const dependencies = collectDependencies(
			resolve({
				variants: [
					{
						key: 'quick',
						steps: [
							{
								fields: [
									{ Component: './Top#Top', type: 'component' },
									{
										fields: [
											{
												fields: [{ Component: './Deep#Deep', type: 'component' }],
												type: 'row',
											},
										],
										label: 'More',
										type: 'collapsible',
									},
								],
								key: 'identity',
							},
						],
					},
				],
			}),
			undefined
		)

		expect(paths(dependencies)).toEqual(expect.arrayContaining(['./Deep#Deep', './Top#Top']))
	})

	it('skips slots a level set to false', () => {
		const dependencies = collectDependencies(resolve({ variants: [{ key: 'native' }] }), {
			Progress: false,
		})
		expect(paths(dependencies)).toEqual(['@10x-media/form-variants/rsc#VariantEditView'])
	})
})

describe('withVariantView', () => {
	it('registers the view as edit.default and leaves the rest of the collection alone', () => {
		const collection = withVariantView({
			admin: { useAsTitle: 'lastName' },
			fields: [],
			slug: 'people',
		})
		expect(collection.admin?.components?.views?.edit).toEqual({
			default: { Component: '@10x-media/form-variants/rsc#VariantEditView' },
		})
		expect(collection.admin?.useAsTitle).toBe('lastName')
	})
})
