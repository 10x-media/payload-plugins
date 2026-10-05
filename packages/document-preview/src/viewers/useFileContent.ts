'use client'

import { useEffect, useState } from 'react'

type ContentKind = 'arrayBuffer' | 'text'

type ContentOf<K extends ContentKind> = K extends 'text' ? string : ArrayBuffer

export type FileContentState<K extends ContentKind> =
	| { content: ContentOf<K>; status: 'ready' }
	| { error: Error; status: 'error' }
	| { size: number; status: 'tooLarge' }
	| { status: 'loading' }

/**
 * Fetch a file for a viewer that parses it in the browser. `maxBytes` is
 * checked against the stored size before any request, and against
 * `Content-Length` (or the body) after, since the stored size can be missing.
 * Credentials use the fetch default, so a same-origin Payload route sees the
 * session cookie and a public bucket with `Access-Control-Allow-Origin: *`
 * still answers.
 */
export const useFileContent = <K extends ContentKind>({
	filesize,
	kind,
	maxBytes,
	url,
}: {
	filesize: number | undefined
	kind: K
	maxBytes: number
	url: string
}): FileContentState<K> => {
	const [state, setState] = useState<FileContentState<K>>({ status: 'loading' })

	useEffect(() => {
		if (filesize !== undefined && filesize > maxBytes) {
			setState({ size: filesize, status: 'tooLarge' })
			return
		}
		const controller = new AbortController()
		setState({ status: 'loading' })
		const load = async () => {
			const response = await fetch(url, { signal: controller.signal })
			if (!response.ok) {
				throw new Error(`${response.status} ${response.statusText}`)
			}
			const length = Number(response.headers.get('content-length'))
			if (length > maxBytes) {
				controller.abort()
				setState({ size: length, status: 'tooLarge' })
				return
			}
			const content = kind === 'text' ? await response.text() : await response.arrayBuffer()
			const size = typeof content === 'string' ? content.length : content.byteLength
			if (size > maxBytes) {
				setState({ size, status: 'tooLarge' })
				return
			}
			setState({ content: content as ContentOf<K>, status: 'ready' })
		}
		load().catch((error: unknown) => {
			if (controller.signal.aborted) {
				return
			}
			setState({
				error: error instanceof Error ? error : new Error(String(error)),
				status: 'error',
			})
		})
		return () => controller.abort()
	}, [filesize, kind, maxBytes, url])

	return state
}
