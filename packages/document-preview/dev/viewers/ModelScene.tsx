'use client'

import type { DocumentPreviewViewerProps } from '@10x-media/document-preview/types'
import { useEffect, useRef, useState } from 'react'
import {
	Box3,
	Color,
	DirectionalLight,
	type Group,
	HemisphereLight,
	Mesh,
	MeshStandardMaterial,
	type Object3D,
	PerspectiveCamera,
	PMREMGenerator,
	Scene,
	Vector3,
	WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import './model-viewer.css'

type Format = 'gltf' | 'obj' | 'stl'

const formatOf = (mimeType: string, filename: string): Format | undefined => {
	const extension = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase()
	if (mimeType.startsWith('model/gltf') || extension === 'glb' || extension === 'gltf') {
		return 'gltf'
	}
	if (mimeType === 'model/stl' || extension === 'stl') {
		return 'stl'
	}
	if (mimeType === 'model/obj' || extension === 'obj') {
		return 'obj'
	}
	return undefined
}

/** Untextured formats get a neutral clay material, so their shape reads under the lights. */
const clay = () => new MeshStandardMaterial({ color: 0xb8bcc4, metalness: 0.1, roughness: 0.6 })

const load = async (format: Format, url: string): Promise<Object3D> => {
	if (format === 'gltf') {
		const gltf = await new GLTFLoader().loadAsync(url)
		return gltf.scene
	}
	if (format === 'stl') {
		const geometry = await new STLLoader().loadAsync(url)
		geometry.computeVertexNormals()
		// Binary STL can carry per-face colours; keep them when present.
		const material = geometry.hasAttribute('color')
			? new MeshStandardMaterial({ roughness: 0.6, vertexColors: true })
			: clay()
		// STL is Z-up by convention; three.js is Y-up.
		const mesh = new Mesh(geometry, material)
		mesh.rotation.x = -Math.PI / 2
		return mesh
	}
	const group: Group = await new OBJLoader().loadAsync(url)
	group.traverse((child) => {
		if (child instanceof Mesh) {
			child.material = clay()
		}
	})
	return group
}

/** Frames the whole model from a three-quarter angle and makes it the orbit target. */
const frame = (model: Object3D, camera: PerspectiveCamera, controls: OrbitControls) => {
	const box = new Box3().setFromObject(model)
	const size = box.getSize(new Vector3()).length() || 1
	const center = box.getCenter(new Vector3())
	camera.near = size / 100
	camera.far = size * 100
	camera.position.copy(center).add(new Vector3(0.6, 0.45, 0.8).multiplyScalar(size))
	camera.updateProjectionMatrix()
	controls.target.copy(center)
	controls.update()
}

/** The admin's surface colour, read off the page so the canvas matches the theme. */
const themeBackground = (element: HTMLElement) =>
	new Color(getComputedStyle(element).getPropertyValue('--theme-elevation-50').trim() || '#f3f3f3')

const dispose = (root: Object3D) => {
	root.traverse((child) => {
		if (child instanceof Mesh) {
			child.geometry.dispose()
			for (const material of [child.material].flat()) {
				material.dispose()
			}
		}
	})
}

export const ModelScene = ({ filename, mimeType, url }: DocumentPreviewViewerProps) => {
	const mountRef = useRef<HTMLDivElement>(null)
	const controlsRef = useRef<OrbitControls | null>(null)
	const resetRef = useRef<() => void>(() => undefined)
	const [status, setStatus] = useState<'error' | 'loading' | 'ready'>('loading')
	const [spinning, setSpinning] = useState(true)

	useEffect(() => {
		const mount = mountRef.current
		const format = formatOf(mimeType, filename)
		if (!mount || !format) {
			setStatus('error')
			return
		}
		const renderer = new WebGLRenderer({ antialias: true })
		renderer.setPixelRatio(window.devicePixelRatio)
		mount.appendChild(renderer.domElement)

		const scene = new Scene()
		scene.background = themeBackground(mount)
		const environment = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04)
		scene.environment = environment.texture
		scene.add(new HemisphereLight(0xffffff, 0x444444, 0.6))
		const sun = new DirectionalLight(0xffffff, 1.2)
		sun.position.set(3, 5, 4)
		scene.add(sun)

		const camera = new PerspectiveCamera(40, 1, 0.01, 1000)
		const controls = new OrbitControls(camera, renderer.domElement)
		controls.enableDamping = true
		controls.autoRotate = true
		controls.autoRotateSpeed = 1.2
		controlsRef.current = controls

		const resize = () => {
			const { clientHeight, clientWidth } = mount
			renderer.setSize(clientWidth, clientHeight)
			camera.aspect = clientWidth / Math.max(1, clientHeight)
			camera.updateProjectionMatrix()
		}
		const observer = new ResizeObserver(resize)
		observer.observe(mount)
		resize()
		renderer.setAnimationLoop(() => {
			controls.update()
			renderer.render(scene, camera)
		})

		let model: Object3D | undefined
		let cancelled = false
		load(format, url)
			.then((loaded) => {
				if (cancelled) {
					dispose(loaded)
					return
				}
				model = loaded
				scene.add(loaded)
				resetRef.current = () => frame(loaded, camera, controls)
				resetRef.current()
				setStatus('ready')
			})
			.catch((error: unknown) => {
				console.error(`[model-viewer] could not load ${url}`, error)
				if (!cancelled) {
					setStatus('error')
				}
			})

		return () => {
			cancelled = true
			observer.disconnect()
			renderer.setAnimationLoop(null)
			controls.dispose()
			if (model) {
				dispose(model)
			}
			environment.dispose()
			renderer.dispose()
			renderer.domElement.remove()
			controlsRef.current = null
		}
	}, [filename, mimeType, url])

	useEffect(() => {
		if (controlsRef.current) {
			controlsRef.current.autoRotate = spinning
		}
	}, [spinning])

	return (
		<div className="model-viewer">
			<div className="model-viewer__stage" ref={mountRef}>
				{status === 'loading' ? <div className="model-viewer__status">Loading model…</div> : null}
				{status === 'error' ? (
					<div className="model-viewer__status">This model could not be displayed.</div>
				) : null}
			</div>
			<div className="document-preview-toolbar">
				<button
					aria-pressed={spinning}
					className="document-preview-toolbar__button document-preview-toolbar__button--text"
					disabled={status !== 'ready'}
					onClick={() => setSpinning((value) => !value)}
					type="button"
				>
					Auto-rotate
				</button>
				<button
					className="document-preview-toolbar__button document-preview-toolbar__button--text"
					disabled={status !== 'ready'}
					onClick={() => resetRef.current()}
					type="button"
				>
					Reset view
				</button>
			</div>
		</div>
	)
}
