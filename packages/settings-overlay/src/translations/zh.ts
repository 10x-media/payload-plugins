import { keys, type TranslationKey } from './keys'

export const zh: Record<TranslationKey, string> = {
	[keys.pluginName]: '设置面板',
	[keys.appearanceLabel]: '外观',
	[keys.back]: '返回',
	[keys.close]: '关闭',
	[keys.discardBody]: '有未保存的更改。现在离开将会丢弃它们。',
	[keys.discardConfirm]: '放弃更改',
	[keys.discardHeading]: '放弃更改？',
	[keys.empty]: '这里还没有内容。',
	[keys.loadFailed]: '加载失败，请重试。',
	[keys.noResults]: '没有匹配项。',
	[keys.searchPlaceholder]: '搜索',
	[keys.widgetNotice]: '此小组件并非用于展示。您可以将其从仪表板中移除。',
}
