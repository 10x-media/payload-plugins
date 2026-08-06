import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Shared driving code for the undo/redo e2e specs.
 *
 * Every spec creates the documents it needs through the REST API rather than
 * reusing the dev seed. The history is client-side, so most tests never save
 * and would not pollute anything, but the few that do save must not leave a
 * mutated document behind for the next spec to trip over.
 */

const ADMIN = { email: 'dev@10xmedia.de', password: 'password' }

/** The mounted history, reduced to primitives so it survives `page.evaluate`. */
export interface HistoryProbe {
	/** Entry the form currently shows. */
	index: number
	/** Entries captured so far, after any eviction by `maxHistory`. */
	length: number
	/** False under autosave, where the saved baseline is deliberately not tracked. */
	hasBaseline: boolean
}

export const login = async (page: Page): Promise<void> => {
	const res = await page.request.post('/api/users/login', { data: ADMIN })
	expect(res.ok()).toBeTruthy()
}

export const createDoc = async (
	page: Page,
	collection: string,
	data: Record<string, unknown>
): Promise<string> => {
	const res = await page.request.post(`/api/${collection}`, { data })
	if (!res.ok()) throw new Error(`create ${collection} failed: ${await res.text()}`)
	const { doc } = (await res.json()) as { doc: { id: number | string } }
	return String(doc.id)
}

/** `apiPath` is everything after `/api/`, so a caller can pin a locale. */
export const readDoc = async (page: Page, apiPath: string): Promise<Record<string, unknown>> => {
	const res = await page.request.get(`/api/${apiPath}`)
	if (!res.ok()) throw new Error(`read ${apiPath} failed: ${await res.text()}`)
	return (await res.json()) as Record<string, unknown>
}

export const undoButton = (page: Page): Locator => page.locator('.undo-redo-controls__undo')
export const redoButton = (page: Page): Locator => page.locator('.undo-redo-controls__redo')
export const debugButton = (page: Page): Locator => page.locator('.undo-redo-controls__debug')
export const saveButton = (page: Page): Locator => page.locator('#action-save')

/** Payload builds field ids from the form path with dots replaced by `__`. */
export const field = (page: Page, path: string): Locator =>
	page.locator(`#field-${path.replace(/\./g, '__')}`)

/**
 * A mounted Lexical editing surface. Rich text fields carry no `id` at all, so
 * they are addressed through the path attribute the editor renders instead.
 */
export const richText = (page: Page, path: string): Locator =>
	page.locator(`[data-field-path="${path}"] .ContentEditable__root`)

export const readHistory = async (page: Page): Promise<HistoryProbe | null> =>
	page.evaluate(() => {
		const history = (
			window as unknown as {
				__payloadUndoHistory?: { index: number; savedComparable: unknown; stack: unknown[] }
			}
		).__payloadUndoHistory
		if (!history) return null
		return {
			hasBaseline: history.savedComparable !== null,
			index: history.index,
			length: history.stack.length,
		}
	})

/**
 * Wait until the history holds exactly `entries`.
 *
 * Exactly, not at least: the capture debounce means an assertion that runs too
 * early passes for the wrong reason, and an extra entry is itself a bug worth
 * failing on, since a phantom capture is what silently truncates the redo tail.
 */
export const waitForEntries = async (page: Page, entries: number): Promise<void> => {
	await expect
		.poll(async () => (await readHistory(page))?.length ?? 0, { timeout: 10_000 })
		.toBe(entries)
}

const entryIndex = async (page: Page): Promise<number> => (await readHistory(page))?.index ?? -1

/**
 * The value one path holds in the entry the form currently shows.
 *
 * Needed once `maxHistory` starts evicting, where both the index and the stack
 * length saturate and stop being a usable signal that a new edit was captured.
 */
export const entryValue = async (page: Page, path: string): Promise<unknown> =>
	page.evaluate((fieldPath) => {
		const history = (
			window as unknown as {
				__payloadUndoHistory?: {
					index: number
					stack: { comparable: Record<string, { value?: unknown }> }[]
				}
			}
		).__payloadUndoHistory
		const entry = history?.stack[history.index]
		return entry ? (entry.comparable[fieldPath]?.value ?? null) : null
	}, path)

/**
 * Open a document and wait for the form to finish initializing, which is the
 * point the first history entry is captured. Restores dispatched before that
 * would race with Payload's own initial form state.
 */
export const openDoc = async (page: Page, collection: string, id: string): Promise<void> => {
	await page.goto(`/admin/collections/${collection}/${id}`)
	await expect(saveButton(page)).toBeVisible()
}

export const openDocWithHistory = async (
	page: Page,
	collection: string,
	id: string
): Promise<void> => {
	await openDoc(page, collection, id)
	await waitForEntries(page, 1)
}

export const openGlobal = async (page: Page, slug: string): Promise<void> => {
	await page.goto(`/admin/globals/${slug}`)
	await expect(saveButton(page)).toBeVisible()
	await waitForEntries(page, 1)
}

/**
 * Step the history and wait for the index to land, so a following assertion
 * cannot read the form mid-restore. Callers are expected to have settled any
 * pending capture first (see `waitForEntries`), which is what makes the index
 * move by exactly one per step.
 */
export const undo = async (page: Page, steps = 1): Promise<void> => {
	for (let step = 0; step < steps; step++) {
		const from = await entryIndex(page)
		await undoButton(page).click()
		await expect.poll(() => entryIndex(page)).toBe(from - 1)
	}
}

export const redo = async (page: Page, steps = 1): Promise<void> => {
	for (let step = 0; step < steps; step++) {
		const from = await entryIndex(page)
		await redoButton(page).click()
		await expect.poll(() => entryIndex(page)).toBe(from + 1)
	}
}

/**
 * Move focus off the edited field and onto nothing, so keyboard events land on
 * `document.body`. The shortcuts deliberately skip form tags and contenteditable,
 * where the browser and Lexical own undo, so a test pressing them has to leave
 * the field first, exactly as an editor would.
 */
export const blurToBody = async (target: Locator): Promise<void> => {
	await target.blur()
}

export const openTab = async (page: Page, label: string): Promise<void> => {
	await page.locator('.tabs-field__tab-button', { hasText: label }).first().click()
}

/** History entries only: the overlay renders pending edits with the same class. */
export const overlayEntries = (page: Page): Locator =>
	page.locator('.undo-redo-debug__entry:not(.undo-redo-debug__entry--pending)')

/** Row action popup for the nth row of an array or blocks field. */
export const rowAction = async (rows: Locator, index: number, action: string): Promise<void> => {
	await rows.nth(index).locator('.array-actions__button').first().click()
	await rows.page().locator(`.array-actions__${action}:visible`).first().click()
}

/**
 * Reorder by dragging, the way an editor actually does it.
 *
 * Three things make this fiddly.
 *
 * dnd-kit arms its mouse sensor only once the pointer has travelled 5px, so the
 * gesture has to be a real sequence of moves rather than one jump.
 *
 * It also auto-scrolls once a drag nears a viewport edge, and array rows are
 * tall enough that a list rarely fits on screen. Any coordinate measured before
 * the drag is then wrong by the time the pointer arrives, so the gesture is
 * parked in the middle of the viewport first.
 *
 * Finally, Payload registers the whole row list as a droppable alongside the
 * rows themselves, so `closestCenter` weighs the list's centre against each
 * row's: land between two rows and the drop resolves to the list, which Payload
 * reads as index -1 and appends instead of moving. Aim at the target row's
 * centre exactly, and do not target the middle row of an odd-length list, where
 * the two centres coincide and the list wins the tie.
 */
export const dragRow = async (rows: Locator, from: number, to: number): Promise<void> => {
	const page = rows.page()
	const viewport = page.viewportSize()
	const before = { from: await rows.nth(from).boundingBox(), to: await rows.nth(to).boundingBox() }
	if (!viewport || !before.from || !before.to) {
		throw new Error(`rows ${from} and ${to} are not both visible`)
	}
	const centre = (box: { height: number; y: number }) => box.y + box.height / 2
	await page.evaluate(
		(delta) => window.scrollBy(0, delta),
		(centre(before.from) + centre(before.to)) / 2 - viewport.height / 2
	)

	const grip = await rows.nth(from).locator('.collapsible__drag').first().boundingBox()
	const source = await rows.nth(from).boundingBox()
	const target = await rows.nth(to).boundingBox()
	if (!grip || !source || !target) throw new Error(`rows ${from} and ${to} are not both visible`)
	const startX = grip.x + grip.width / 2
	const startY = grip.y + grip.height / 2
	// Translated by the distance between the two row centres, not moved onto the
	// target: collision detection compares the dragged row's centre, and the
	// pointer sits at the drag handle rather than at that centre.
	const travel = centre(target) - centre(source)

	await page.mouse.move(startX, startY)
	await page.mouse.down()
	await page.mouse.move(startX, startY + Math.sign(travel) * 8, { steps: 4 })
	await page.mouse.move(startX, startY + travel, { steps: 12 })
	await page.mouse.up()
}

export const arrayRows = (page: Page, path: string): Locator =>
	field(page, path).locator('.array-field__draggable-rows').first().locator(':scope > *')

export const blockRows = (page: Page, path: string): Locator =>
	field(page, path).locator('.blocks-field__rows').first().locator(':scope > *')

export const saveDoc = async (page: Page, collection: string): Promise<void> => {
	const saved = page.waitForResponse(
		(res) => res.url().includes(`/api/${collection}`) && res.request().method() === 'PATCH'
	)
	await saveButton(page).click()
	expect((await saved).ok()).toBeTruthy()
}
