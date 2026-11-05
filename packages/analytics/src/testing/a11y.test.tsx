import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { a11yViolations } from './a11y'

afterEach(() => {
	cleanup()
	document.body.innerHTML = ''
})

// Guards the checker itself: a rule that never fires would pass every surface vacuously.
describe('a11yViolations', () => {
	// Markup rather than JSX: it is broken on purpose, which the linter would rightly refuse.
	it('finds each rule broken', () => {
		const container = document.createElement('div')
		container.innerHTML = [
			'<button type="button"></button>',
			'<span aria-live="polite">3 active</span>',
			'<div aria-hidden="true"><button type="button">hidden</button></div>',
			'<div role="img"></div>',
			'<table><tbody><tr><td>1</td></tr></tbody></table>',
			'<table><thead><tr><th aria-sort="ascending" scope="col">a</th><th aria-sort="descending">b</th></tr></thead></table>',
			'<table><thead><tr><th scope="col"></th></tr></thead><tbody><tr><th>x</th><td aria-sort="sideways">1</td></tr></tbody></table>',
			'<span aria-labelledby="missing" id="twice"></span>',
			'<span id="twice" tabindex="2"></span>',
			'<button aria-controls="nowhere" type="button">Open</button>',
			'<input type="text">',
		].join('')
		document.body.append(container)
		expect(a11yViolations(container)).toEqual([
			'unnamed control <button>',
			'unnamed field <input>',
			'unnamed image <div>',
			'aria-labelledby names no element: missing',
			'aria-controls names no element: nowhere',
			'duplicate id twice',
			'positive tabindex on <span>',
			'focusable inside aria-hidden <div>',
			'table without headers <table>',
			'column header without scope="col" in <table>',
			'more than one sorted column in <table>',
			'empty column header in <table>',
			'row header without scope="row" in <table>',
			'invalid aria-sort sideways on <td>',
			'visible live region <span>',
		])
	})

	it('passes a hidden announcer, a named table and a labelled control', () => {
		const { container } = render(
			<div>
				<span aria-live="polite" className="analytics-sr-only" />
				<button aria-label="Remove filter" type="button" />
				<table aria-label="Pages">
					<thead>
						<tr>
							<th scope="col">Page</th>
							<th aria-sort="descending" scope="col">
								Views
							</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<th scope="row">/</th>
							<td>3</td>
						</tr>
					</tbody>
				</table>
			</div>
		)
		expect(a11yViolations(container)).toEqual([])
	})
})
