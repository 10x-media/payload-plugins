// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { buildSprite, sanitizeIconSvg } from './sprite'

/**
 * An upload layer's SVGs are written by whoever can upload media. On a multi-tenant
 * install that is a per-tenant editor, a customer rather than a platform operator, and
 * this markup is rendered inline into the shared admin. These vectors are the escalation
 * paths that makes real, which is why sanitising is a dependency's job and not a regex.
 */
describe('sanitizeIconSvg', () => {
	it.each([
		['<svg><script>alert(1)</script><path d="M0 0"/></svg>', 'script'],
		['<svg><path d="M0 0" onload="alert(1)"/></svg>', 'onload'],
		['<svg><path d="M0 0" onclick="alert(1)"/></svg>', 'onclick'],
		[
			'<svg><foreignObject><body xmlns="http://www.w3.org/1999/xhtml">x</body></foreignObject></svg>',
			'foreignObject',
		],
		['<svg><a href="javascript:alert(1)"><path d="M0 0"/></a></svg>', 'javascript:'],
		['<svg><image href="data:text/html;base64,PHNjcmlwdD4="/></svg>', 'data:text/html'],
		['<svg><use href="https://evil.example/x.svg#a"/></svg>', 'evil.example'],
		['<svg><style>@import url(https://evil.example/x.css);</style></svg>', '@import'],
	])('strips %#: removes %s', (input, forbidden) => {
		expect(sanitizeIconSvg(input).toLowerCase()).not.toContain(forbidden.toLowerCase())
	})

	it('keeps the drawing itself intact', () => {
		const clean = sanitizeIconSvg('<svg viewBox="0 0 24 24"><path d="M0 0h24"/></svg>')
		expect(clean).toContain('<path')
		expect(clean).toContain('d="M0 0h24"')
	})
})

describe('buildSprite', () => {
	it('emits one symbol per icon, carrying each source viewBox', () => {
		const sprite = buildSprite(
			{
				flag: '<svg viewBox="0 0 640 480"><rect width="640" height="480" fill="red"/></svg>',
				mark: '<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>',
			},
			'lib'
		)
		expect(sprite.ids.flag).toBe('lib-0')
		expect(sprite.ids.mark).toBe('lib-1')
		expect(sprite.markup).toContain('<symbol id="lib-0" viewBox="0 0 640 480">')
		expect(sprite.markup).toContain('<symbol id="lib-1" viewBox="0 0 24 24">')
		expect(sprite.markup).toContain('fill="red"')
	})

	// Ids are positional rather than name-derived: an icon name may hold characters that
	// are legal in a name but not in a CSS-addressable id.
	it('never derives an id from the icon name', () => {
		const sprite = buildSprite({ 'a.b#c': '<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>' }, 'lib')
		expect(sprite.ids['a.b#c']).toBe('lib-0')
		expect(sprite.markup).not.toContain('a.b#c')
	})

	it('defaults a missing viewBox rather than emitting an unscalable symbol', () => {
		const sprite = buildSprite({ x: '<svg><path d="M0 0"/></svg>' }, 'lib')
		expect(sprite.markup).toContain('viewBox="0 0 24 24"')
	})

	it('drops an entry whose markup is not an svg', () => {
		const sprite = buildSprite(
			{ bad: '<div>nope</div>', good: '<svg viewBox="0 0 2 2"><path/></svg>' },
			'lib'
		)
		expect(sprite.ids.bad).toBeUndefined()
		expect(sprite.ids.good).toBeDefined()
	})

	it('sanitises on the way into the sprite', () => {
		const sprite = buildSprite(
			{ x: '<svg viewBox="0 0 1 1"><script>alert(1)</script><path d="M0 0"/></svg>' },
			'lib'
		)
		expect(sprite.markup).not.toContain('script')
		expect(sprite.markup).toContain('<path')
	})
})
