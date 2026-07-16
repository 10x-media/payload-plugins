export type UploadFileInput = {
	file: File
	/** Upload collection slug. File fields carry it as the server-stamped `collection` block config. */
	collection: string
	apiRoute?: string
	fetchImpl?: typeof fetch
}

export type UploadFileResult = { ok: true; id: string | number } | { ok: false; message?: string }

/**
 * Upload one file to a Payload upload collection (`POST {apiRoute}/{collection}`, multipart) and return its
 * id, which the file field stores as its value. The server re-derives the file metadata from the stored doc
 * at submit, so the client is never trusted for it. Pure: inject `fetchImpl` in tests.
 */
export const uploadFile = async (input: UploadFileInput): Promise<UploadFileResult> => {
	const { file, collection, apiRoute = '/api', fetchImpl = fetch } = input
	const body = new FormData()
	body.append('file', file)
	let response: Response
	try {
		response = await fetchImpl(`${apiRoute}/${collection}`, { method: 'POST', body })
	} catch (error) {
		return { ok: false, message: error instanceof Error ? error.message : 'Network error' }
	}
	if (!response.ok) {
		return { ok: false, message: `Upload failed (${response.status})` }
	}
	const data = (await response.json().catch(() => ({}))) as { doc?: { id?: string | number } }
	const id = data.doc?.id
	return id == null ? { ok: false, message: 'No id returned' } : { ok: true, id }
}
