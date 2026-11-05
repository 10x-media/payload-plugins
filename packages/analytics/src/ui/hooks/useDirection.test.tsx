import { act, cleanup, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { arrowStep, directionOf, useDirection } from './useDirection'

afterEach(() => {
	cleanup()
	document.documentElement.removeAttribute('dir')
})

function Probe() {
	const ref = useRef<HTMLSpanElement>(null)
	const direction = useDirection(ref)
	return <span ref={ref}>{direction}</span>
}

describe('directionOf', () => {
	it('reads the nearest dir attribute in either case, as Payload writes it', () => {
		const outer = document.createElement('div')
		outer.setAttribute('dir', 'RTL')
		const inner = document.createElement('span')
		outer.append(inner)
		document.body.append(outer)
		expect(directionOf(inner)).toBe('rtl')
		inner.setAttribute('dir', 'ltr')
		expect(directionOf(inner)).toBe('ltr')
		outer.remove()
	})
})

describe('useDirection', () => {
	it('settles on the page direction once mounted', () => {
		const { container } = render(
			<div dir="rtl">
				<Probe />
			</div>
		)
		expect(container.textContent).toBe('rtl')
	})

	it('follows a language switch that rewrites the html dir in place', async () => {
		const { container } = render(<Probe />)
		expect(container.textContent).toBe('ltr')
		await act(async () => {
			document.documentElement.setAttribute('dir', 'rtl')
			await Promise.resolve()
		})
		expect(container.textContent).toBe('rtl')
	})
})

describe('arrowStep', () => {
	it('steps forward with the arrow that points along the reading direction', () => {
		expect(arrowStep('ArrowRight', 'ltr')).toBe(1)
		expect(arrowStep('ArrowLeft', 'ltr')).toBe(-1)
		expect(arrowStep('ArrowRight', 'rtl')).toBe(-1)
		expect(arrowStep('ArrowLeft', 'rtl')).toBe(1)
		expect(arrowStep('ArrowUp', 'rtl')).toBeNull()
		expect(arrowStep('Home', 'ltr')).toBeNull()
	})
})
