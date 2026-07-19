import { expect, type Locator, type Page, test } from '@playwright/test'

const DEV_EMAIL = 'dev@10xmedia.de'
const DEV_PASSWORD = 'password'

/** The Kitchen Sink seeds one block per conditionable type, in this stored order (block index = row index). */
const FIELD_BLOCKS = ['Text', 'Number', 'Date', 'Select', 'Checkbox'] as const

type RuntimeErrors = { entries: string[] }

/**
 * Collect uncaught page errors and `console.error` output for the life of the page. Under prod
 * `next start` a thrown field-render error can be swallowed before it reaches `pageerror`, so every
 * checkpoint pairs this with a positive assertion that the expected control actually rendered.
 */
const trackRuntimeErrors = (page: Page): RuntimeErrors => {
	const entries: string[] = []
	page.on('pageerror', (err) => entries.push(`pageerror: ${err.message}`))
	page.on('console', (msg) => {
		if (msg.type() === 'error') {
			entries.push(`console.error: ${msg.text()}`)
		}
	})
	return { entries }
}

/**
 * Assert nothing has thrown up to this checkpoint, by all three signals: no collected page/console
 * error, no Payload field error-boundary fallback, and no generic "Something went wrong" text. The
 * boundary/fallback checks are the belt for the swallow case where `pageerror` never fires.
 */
const expectNoRuntimeErrors = async (
	page: Page,
	errors: RuntimeErrors,
	at: string
): Promise<void> => {
	expect(errors.entries, `runtime errors at ${at}`).toEqual([])
	await expect(
		page.locator('.payload-error-boundary, [class*="error-boundary"]'),
		`field error boundary at ${at}`
	).toHaveCount(0)
	await expect(page.getByText('Something went wrong'), `error fallback at ${at}`).toHaveCount(0)
}

const login = async (page: Page): Promise<void> => {
	const res = await page.request.post('/api/users/login', {
		data: { email: DEV_EMAIL, password: DEV_PASSWORD },
	})
	expect(res.ok()).toBeTruthy()
}

/** Open a Payload react-select (its `.react-select` container) and pick the option labeled `name`. */
const pickField = async (fieldSelect: Locator, name: string): Promise<void> => {
	await fieldSelect.locator('.rs__control').click()
	await fieldSelect.locator('.rs__option', { hasText: name }).click()
	await expect(fieldSelect).toContainText(name)
}

test.describe('Kitchen Sink admin', () => {
	// The bug: a select or date field chosen in a WhereBuilder condition (field visibleWhen/validateWhen
	// or a flow transition) threw because the synthesized client field carried no `admin`, which
	// Payload's Select/Date condition inputs read unguarded. This drives every condition surface and
	// asserts each value control renders. It reproduces the crash: pre-fix the leaf renders empty, so
	// the positive `toBeVisible` assertions below fail (the select and date checkpoints in particular).
	test('every condition value input renders without a runtime error', async ({ page }) => {
		const errors = trackRuntimeErrors(page)

		await login(page)
		await page.goto('/admin/collections/forms')
		await page.getByRole('link', { name: 'Kitchen Sink' }).click()

		await expect(page.locator('#field-title')).toHaveValue('Kitchen Sink')
		await expectNoRuntimeErrors(page, errors, 'edit view load')

		// Blocks default to expanded; "Show All" is a no-op belt against a collapsed preference.
		const showAll = page.getByRole('button', { name: 'Show All' })
		if ((await showAll.count()) > 0) {
			await showAll.first().click()
		}

		const blocks = page.locator('.blocks-field__row')

		// Walk each field block's tabs. Validation mounts the seeded `validateWhen`, Advanced the seeded
		// `visibleWhen`; across the blocks these mount every condition leaf type at least once.
		for (let i = 0; i < FIELD_BLOCKS.length; i++) {
			const block = blocks.nth(i)
			for (const tab of ['Field', 'Validation', 'Advanced'] as const) {
				await block.getByRole('button', { name: tab, exact: true }).click()
				await expectNoRuntimeErrors(page, errors, `${FIELD_BLOCKS[i]} block / ${tab} tab`)
			}
		}

		// The two the owner actually hit. Text.visibleWhen names the Select operand (SelectCondition),
		// Number.visibleWhen names the Date operand (DateCondition). Pre-fix both render nothing.
		const textBlock = blocks.nth(0)
		await textBlock.getByRole('button', { name: 'Advanced', exact: true }).click()
		await expect(textBlock.locator('.fb-condition-row__value .rs__control')).toBeVisible()
		await expect(textBlock.locator('.fb-condition-row__value')).toContainText('Option A')

		const numberBlock = blocks.nth(1)
		await numberBlock.getByRole('button', { name: 'Advanced', exact: true }).click()
		await expect(
			numberBlock.locator('.fb-condition-row__value .condition-value-date')
		).toBeVisible()
		await expectNoRuntimeErrors(page, errors, 'seeded select and date leaves')

		// Flow tab: the step field list and the interactive WHEN builder.
		await page.getByRole('button', { name: 'Flow', exact: true }).click()
		await expectNoRuntimeErrors(page, errors, 'flow tab')

		const step1 = page.locator('.fb-flow-step').first()
		await step1.locator('.collapsible__toggle').first().click()

		// TODO(T4): the step field list shows machine names today; once T4 lands label display, assert the
		// human labels ('Text field', 'Number field', ...) here instead of the names.
		await expect(step1.locator('.fb-flow-step__field-picker')).toContainText('ksText')
		await expect(step1.locator('.fb-flow-step__field-picker')).toContainText('ksNumber')

		await step1.getByRole('button', { name: 'Add transition' }).click()
		const transition = step1.locator('.fb-flow-transition').last()
		await transition.getByRole('button', { name: 'Add condition' }).click()

		const row = transition.locator('.fb-condition-row')
		const fieldSelect = row.locator('.fb-condition-row__field')
		const value = row.locator('.fb-condition-row__value')

		// The new condition defaults to the first operand (text); cycle the field select through every
		// type and assert the matching value control renders after each. The select step is the crash.
		await expect(value.locator('.condition-value-text')).toBeVisible()
		await expectNoRuntimeErrors(page, errors, 'when builder / text leaf')

		await pickField(fieldSelect, 'Number field')
		await expect(value.locator('.condition-value-number')).toBeVisible()
		await expectNoRuntimeErrors(page, errors, 'when builder / number leaf')

		await pickField(fieldSelect, 'Date field')
		await expect(value.locator('.condition-value-date')).toBeVisible()
		await expectNoRuntimeErrors(page, errors, 'when builder / date leaf')

		await pickField(fieldSelect, 'Select field')
		await expect(value.locator('.rs__control')).toBeVisible()
		await expectNoRuntimeErrors(page, errors, 'when builder / select leaf')

		await pickField(fieldSelect, 'Checkbox field')
		await expect(value.locator('.rs__control')).toBeVisible()
		await expectNoRuntimeErrors(page, errors, 'when builder / checkbox leaf')

		// Poll (gated on pollEnabled) and Actions tabs render without error.
		await page.getByRole('button', { name: 'Poll', exact: true }).click()
		await expect(page.getByText('Results field')).toBeVisible()
		await expectNoRuntimeErrors(page, errors, 'poll tab')

		await page.getByRole('button', { name: 'Actions', exact: true }).click()
		await expectNoRuntimeErrors(page, errors, 'actions tab')
	})
})
