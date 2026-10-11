'use client'

import type { DocumentPreviewViewerProps } from '@10x-media/document-preview/types'
import { lazy, Suspense } from 'react'

const ModelScene = lazy(() => import('./ModelScene').then((m) => ({ default: m.ModelScene })))

/**
 * Dev showcase of a host viewer: 3D models (glTF/GLB, STL, OBJ) with three.js.
 *
 * Everything at a viewer path is imported eagerly by the admin import map, so
 * this file stays tiny and lazy-loads the three.js scene, which only downloads
 * when a model is opened. That is the pattern a heavy custom viewer should
 * follow.
 */
export const ModelViewer = (props: DocumentPreviewViewerProps) => (
	<Suspense fallback={<div className="model-viewer__status">Loading 3D viewer…</div>}>
		<ModelScene {...props} />
	</Suspense>
)
