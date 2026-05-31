import Link from 'next/link'

export default function HomePage() {
	return (
		<main style={{ padding: '4rem 2rem', maxWidth: 720, margin: '0 auto' }}>
			<h1>10x-media Payload plugins</h1>
			<p>Open-source plugins for Payload v3 maintained by 10x-media.</p>
			<p>
				<Link href="/docs">Browse the docs</Link>
			</p>
		</main>
	)
}
