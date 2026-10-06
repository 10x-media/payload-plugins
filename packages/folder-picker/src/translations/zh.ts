import { keys, type TranslationKey } from './keys'

export const zh: Record<TranslationKey, string> = {
	[keys.gridView]: '以网格显示',
	[keys.listView]: '以列表显示',
	[keys.orderLabel]: '顺序',
	[keys.pickManyHint]: '按住 {{modifier}} 可选择多项，按住 {{range}} 可选择一个范围。',
	[keys.pluginName]: '文件夹选择器',
	[keys.retry]: '重试',
	[keys.sortByLabel]: '排序依据',
}
