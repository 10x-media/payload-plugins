import { expect, test } from '@playwright/test'

test('poll: voting reveals per-option results', async ({ page }) => {
	await page.goto('/poll')
	await expect(page.getByRole('heading', { name: 'Poll' })).toBeVisible()

	await page.getByLabel('Favorite framework').selectOption('payload')
	await page.getByRole('button', { name: 'Submit' }).click()

	// After voting, results replace the form (per-browser voted guard). One vote for Payload reads 100%.
	await expect(page.getByText('100%')).toBeVisible()
})
