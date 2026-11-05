import { describe, expect, it } from 'vitest'
import { publicDigest } from '../capture/exclusionToken'
import type { AdminDigest } from './config'
import { inLivePreview, type SkipConfig, skipReason, skipsDraft } from './skip'
import type { TrackerWindow } from './types'

interface Shown {
	/** The page's own address. */
	href?: string
	/** The window showing it: its address, or `cross` for one the page cannot read. */
	parent?: string | 'cross'
	opener?: string | 'cross'
	ancestor?: string
	referrer?: string
	webdriver?: boolean
	/** A page on plain http outside localhost, which has no `crypto.subtle`. */
	insecure?: boolean
}

const located = (address: string | 'cross') => {
	if (address === 'cross') {
		return {
			get location(): never {
				throw new DOMException(
					'Blocked a frame from accessing a cross-origin frame',
					'SecurityError'
				)
			},
		}
	}
	const url = new URL(address)
	return { location: { origin: url.origin, pathname: url.pathname } }
}

/** A window as the tracker reads it: a frame of `parent`, or a window `opener` opened. */
const windowOf = (shown: Shown): TrackerWindow => {
	const self: Record<string, unknown> = {
		location: {
			href: shown.href ?? 'https://site.example/pricing',
			...(shown.ancestor ? { ancestorOrigins: { item: () => shown.ancestor } } : {}),
		},
		document: { referrer: shown.referrer ?? '' },
		navigator: { webdriver: shown.webdriver ?? false },
		opener: shown.opener ? located(shown.opener) : null,
		crypto: shown.insecure ? {} : globalThis.crypto,
	}
	self.parent = shown.parent ? located(shown.parent) : self
	return self as unknown as TrackerWindow
}

/** What the server puts in the config for an admin at `path`, on `origin` when it names one. */
const digestOf = (path: string, origin?: string): AdminDigest => ({
	...(origin === undefined ? {} : { origin: publicDigest(origin) }),
	path: publicDigest(path),
})

const previewed = (admin: AdminDigest, shown: Shown) =>
	inLivePreview({ admin }, windowOf(shown)) ?? Promise.resolve('not checked')

describe('inLivePreview', () => {
	const sameOrigin = digestOf('/admin')

	it("is a frame of the admin's own page on the same origin, and nothing else there", async () => {
		await expect(
			previewed(sameOrigin, { parent: 'https://site.example/admin/collections/pages/1' })
		).resolves.toBe(true)
		await expect(previewed(sameOrigin, { parent: 'https://site.example/admin' })).resolves.toBe(
			true
		)
		await expect(previewed(sameOrigin, { parent: 'https://site.example/admin/' })).resolves.toBe(
			true
		)
		await expect(
			previewed(sameOrigin, { parent: 'https://site.example/blog/embed' })
		).resolves.toBe(false)
		await expect(
			previewed(sameOrigin, { parent: 'https://site.example/administrator' })
		).resolves.toBe(false)
		await expect(
			previewed(sameOrigin, { parent: 'https://other.example/admin/collections/pages/1' })
		).resolves.toBe(false)
	})

	it('is a window the admin opened, as the popup preview is', async () => {
		await expect(
			previewed(sameOrigin, { opener: 'https://site.example/admin/collections/pages/1' })
		).resolves.toBe(true)
	})

	it('is a frame of the CMS origin across origins, named by ancestorOrigins or the referrer', async () => {
		const cms = digestOf('/admin', 'https://cms.example')
		await expect(
			previewed(cms, { parent: 'cross', ancestor: 'https://cms.example' })
		).resolves.toBe(true)
		await expect(
			previewed(cms, { parent: 'cross', referrer: 'https://cms.example/' })
		).resolves.toBe(true)
		await expect(
			previewed(cms, { parent: 'cross', ancestor: 'https://ads.example' })
		).resolves.toBe(false)
		await expect(
			previewed(cms, { opener: 'cross', referrer: 'https://cms.example/' })
		).resolves.toBe(true)
		await expect(previewed(cms, { parent: 'cross' })).resolves.toBe(false)
		await expect(
			previewed(sameOrigin, { parent: 'cross', ancestor: 'https://site.example' })
		).resolves.toBe(false)
	})

	it('reads a CMS on its own origin, path included, from a frame it can read', async () => {
		const cms = digestOf('/cms', 'https://site.example')
		await expect(
			previewed(cms, { parent: 'https://site.example/cms/collections/pages/1' })
		).resolves.toBe(true)
		await expect(previewed(cms, { parent: 'https://site.example/admin' })).resolves.toBe(false)
	})

	it('takes an admin served at the root as every page of its origin', async () => {
		await expect(
			previewed(digestOf('/'), { parent: 'https://site.example/collections/pages/1' })
		).resolves.toBe(true)
	})

	it('checks nothing for a page nothing shows, or one whose previews are counted', () => {
		expect(inLivePreview({ admin: sameOrigin }, windowOf({}))).toBeNull()
		expect(
			inLivePreview(
				{ admin: sameOrigin, skip: { automation: true, previews: false } },
				windowOf({ parent: 'https://site.example/admin' })
			)
		).toBeNull()
		expect(inLivePreview({}, windowOf({ parent: 'https://site.example/admin' }))).toBeNull()
	})

	it('counts a page that cannot hash, as on plain http', async () => {
		await expect(
			previewed(sameOrigin, { parent: 'https://site.example/admin', insecure: true })
		).resolves.toBe(false)
	})
})

describe('skipReason', () => {
	const config: SkipConfig = { admin: digestOf('/admin') }

	it('names automation first, then a draft; the live preview is checked apart', () => {
		expect(skipReason(config, windowOf({ webdriver: true }))).toBe('automation')
		expect(skipReason({ ...config, draft: true }, windowOf({}))).toBe('draft')
		expect(
			skipReason(config, windowOf({ parent: 'https://site.example/admin/collections/pages/1' }))
		).toBeNull()
		expect(skipReason(config, windowOf({}))).toBeNull()
	})

	it('counts what the install asked to count', () => {
		const counted: SkipConfig = { ...config, skip: { automation: false, previews: false } }
		expect(skipReason(counted, windowOf({ webdriver: true }))).toBeNull()
		expect(skipReason({ ...counted, draft: true }, windowOf({}))).toBeNull()
		expect(skipsDraft({ ...counted, draft: true })).toBe(false)
	})

	it('treats a config cached before the option as skipping everything it can', () => {
		expect(skipsDraft({ draft: true })).toBe(true)
		expect(skipReason({}, windowOf({ webdriver: true }))).toBe('automation')
	})
})
