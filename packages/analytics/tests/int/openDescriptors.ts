import { fstatSync, readdirSync, statSync } from 'node:fs'

/** Whether this platform lists a process's open descriptors at `/dev/fd` (macOS and Linux do). */
export const listsDescriptors = (): boolean => {
	try {
		return readdirSync('/dev/fd').length > 0
	} catch {
		return false
	}
}

/**
 * How many descriptors this process holds open on `path`, its worker threads' included: the
 * entries of `/dev/fd` on the file's device and inode. A file that does not exist has none.
 */
export const descriptorsOn = (path: string): number => {
	let file: { dev: number; ino: number }
	try {
		file = statSync(path)
	} catch {
		return 0
	}
	let held = 0
	for (const name of readdirSync('/dev/fd')) {
		try {
			const open = fstatSync(Number(name))
			if (open.dev === file.dev && open.ino === file.ino) {
				held += 1
			}
		} catch {
			// The listing's own descriptor, closed again by the time it is looked at.
		}
	}
	return held
}
