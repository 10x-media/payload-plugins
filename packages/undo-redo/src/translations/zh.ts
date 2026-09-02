import { keys, type TranslationKey } from './keys'

export const zh: Record<TranslationKey, string> = {
	[keys.undo]: '撤销',
	[keys.redo]: '重做',
	[keys.debug]: '撤销历史',
	[keys.debugTooltip]: '查看撤销历史',
	[keys.debugTitle]: '撤销历史',
	[keys.debugEmpty]: '尚未记录任何历史。',
	[keys.debugClose]: '关闭',
	[keys.debugPending]: '待处理（未记录）',
	[keys.debugOriginal]: '原始状态',
	[keys.debugCopy]: '复制 JSON',
}
