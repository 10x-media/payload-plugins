import { keys, type TranslationKey } from './keys'

export const zh: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Webhooks',
	[keys.subscriptionSingular]: '订阅',
	[keys.subscriptionPlural]: '订阅',
	[keys.deliverySingular]: '投递',
	[keys.deliveryPlural]: '投递记录',
	[keys.fieldName]: '名称',
	[keys.fieldUrl]: '端点 URL',
	[keys.fieldEnabled]: '已启用',
	[keys.fieldEvents]: '事件',
	[keys.fieldSecret]: '签名密钥',
	[keys.fieldSecretHelp]:
		'创建时完整显示一次，之后将被遮蔽。它用于签名投递请求，请立即复制到接收方。',
	[keys.fieldHeaders]: '自定义请求头',
	[keys.fieldDescription]: '描述',
	[keys.statusPending]: '待投递',
	[keys.statusSuccess]: '已投递',
	[keys.statusFailed]: '失败',
	[keys.statusDead]: '已放弃',
	[keys.redeliver]: '重新投递',
	[keys.redeliverDone]: '重新投递已加入队列',
}
