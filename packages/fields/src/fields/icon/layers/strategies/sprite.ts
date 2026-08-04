import createDOMPurify from 'dompurify'

/** Used when a source SVG omits its own, so a symbol still scales instead of collapsing. */
const FALLBACK_VIEWBOX = '0 0 24 24'

type Purifier = ReturnType<typeof createDOMPurify>

let purifier: Purifier | null = null

/**
 * A DOMPurify instance private to this module. The reference-scrubbing hook below would
 * otherwise apply to every `DOMPurify.sanitize` call in the process, including a host
 * app's own, which a library has no business doing.
 *
 * Built lazily: this module is only ever imported by the client-side `svg` strategy, and
 * constructing it at import time would need a DOM that a server bundle does not have.
 */
const getPurifier = (): Purifier => {
	if (purifier) return purifier
	const instance = createDOMPurify(globalThis.window)
	// Same-document fragments only. Setting ALLOWED_URI_REGEXP would not do: DOMPurify
	// validates every attribute against it, so restricting it to `^#` also strips `d` and
	// `viewBox` and leaves an empty glyph. This narrows the rule to the reference
	// attributes, retiring cross-document `<use>` and any surviving `data:` payload while
	// a glyph's own internal defs-and-use references keep working.
	instance.addHook('afterSanitizeAttributes', (node) => {
		if (!(node instanceof Element)) return
		for (const attribute of ['href', 'xlink:href']) {
			const value = node.getAttribute(attribute)
			if (value !== null && !value.startsWith('#')) node.removeAttribute(attribute)
		}
	})
	purifier = instance
	return instance
}

/**
 * Sanitises one icon SVG.
 *
 * The trust level here is lower than it looks. An upload-backed layer's SVGs are written
 * by whoever can upload media, which on a multi-tenant install is a per-tenant editor: a
 * customer, not a platform operator. Rendering that markup inline into the shared admin
 * makes it a path from a customer into an operator's authenticated session.
 *
 * The surface is wider than scripts and event handlers alone. `<foreignObject>` embeds
 * arbitrary HTML, `href` and `xlink:href` accept `javascript:` and `data:` URIs, `<use>`
 * can pull cross-document references, and `<style>` can carry `url()` and `@import`. That
 * is security-critical parsing whose failure mode is silent, so it belongs to a
 * maintained dependency rather than an allowlist written here.
 */
export const sanitizeIconSvg = (svg: string): string =>
	getPurifier().sanitize(svg, {
		ADD_TAGS: ['symbol'],
		// `<a>` carries navigation, `<foreignObject>` embeds arbitrary HTML, `<image>` pulls
		// an external or data-URI resource, and `<style>` can carry `url()` and `@import`.
		// An icon needs none of them.
		FORBID_TAGS: ['a', 'foreignObject', 'image', 'script', 'style'],
		USE_PROFILES: { svg: true, svgFilters: true },
	})

export type IconSprite = {
	/** Symbol id per icon name, positional so a name never has to be id-safe. */
	ids: Record<string, string>
	/** Concatenated `<symbol>` elements, already sanitised, for one hidden sprite document. */
	markup: string
}

/**
 * Turns a layer's bulk SVG into one sprite document.
 *
 * Each glyph is parsed and sanitised exactly once here, and every grid cell then renders
 * `<use href="#id">`. That is what makes a large upload-backed library scroll: no
 * per-icon network request, and no re-parse per cell.
 */
export const buildSprite = (svgs: Record<string, string>, idPrefix: string): IconSprite => {
	const parser = new DOMParser()
	const ids: Record<string, string> = {}
	const symbols: string[] = []
	let index = 0
	for (const name of Object.keys(svgs).sort()) {
		const source = svgs[name]
		if (source === undefined) continue
		const clean = sanitizeIconSvg(source)
		const root = parser.parseFromString(clean, 'image/svg+xml').querySelector('svg')
		if (!root) continue
		const id = `${idPrefix}-${index}`
		const viewBox = root.getAttribute('viewBox') ?? FALLBACK_VIEWBOX
		ids[name] = id
		symbols.push(`<symbol id="${id}" viewBox="${viewBox}">${root.innerHTML}</symbol>`)
		index += 1
	}
	return { ids, markup: symbols.join('') }
}
