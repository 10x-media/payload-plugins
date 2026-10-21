import { describe, expect, it } from 'vitest'
import { type NavigateEventLike, softNavigationTarget } from './softNavigationTarget'

const site = { origin: 'https://cms.example', adminRoute: '/admin' }

const navigate = (
	url: string,
	overrides: Partial<Omit<NavigateEventLike, 'preventDefault' | 'destination'>> & {
		sameDocument?: boolean
	} = {}
): Omit<NavigateEventLike, 'preventDefault'> => {
	const { sameDocument = false, ...rest } = overrides
	return {
		cancelable: true,
		navigationType: 'push',
		hashChange: false,
		downloadRequest: null,
		formData: null,
		destination: { url, sameDocument },
		...rest,
	}
}

describe('softNavigationTarget', () => {
	it('takes over a plain link into the admin, keeping query and hash', () => {
		expect(
			softNavigationTarget(navigate('https://cms.example/admin/collections/pages/1?x=1#y'), site)
		).toBe('/admin/collections/pages/1?x=1#y')
	})

	it('takes over the admin root and a location.replace', () => {
		expect(softNavigationTarget(navigate('https://cms.example/admin'), site)).toBe('/admin')
		expect(
			softNavigationTarget(
				navigate('https://cms.example/admin/a', { navigationType: 'replace' }),
				site
			)
		).toBe('/admin/a')
	})

	it('leaves client-side navigations alone, or it would loop on its own router.push', () => {
		expect(
			softNavigationTarget(navigate('https://cms.example/admin/a', { sameDocument: true }), site)
		).toBeNull()
	})

	it('leaves reloads, back and forward to the browser', () => {
		for (const navigationType of ['reload', 'traverse'] as const)
			expect(
				softNavigationTarget(navigate('https://cms.example/admin/a', { navigationType }), site)
			).toBeNull()
	})

	it('leaves downloads, form posts, hash jumps and uncancelable navigations alone', () => {
		const url = 'https://cms.example/admin/a'
		expect(softNavigationTarget(navigate(url, { downloadRequest: 'export.csv' }), site)).toBeNull()
		expect(softNavigationTarget(navigate(url, { formData: {} }), site)).toBeNull()
		expect(softNavigationTarget(navigate(url, { hashChange: true }), site)).toBeNull()
		expect(softNavigationTarget(navigate(url, { cancelable: false }), site)).toBeNull()
	})

	it('leaves the public site, the API and other origins alone', () => {
		expect(softNavigationTarget(navigate('https://cms.example/events/1'), site)).toBeNull()
		expect(
			softNavigationTarget(navigate('https://cms.example/api/events/1/export'), site)
		).toBeNull()
		expect(softNavigationTarget(navigate('https://cms.example/administration'), site)).toBeNull()
		expect(softNavigationTarget(navigate('https://other.example/admin/a'), site)).toBeNull()
	})

	it('follows a custom admin route, with or without slashes', () => {
		expect(
			softNavigationTarget(navigate('https://cms.example/cms/x'), { ...site, adminRoute: 'cms/' })
		).toBe('/cms/x')
		expect(
			softNavigationTarget(navigate('https://cms.example/admin/x'), { ...site, adminRoute: '/cms' })
		).toBeNull()
	})
})
