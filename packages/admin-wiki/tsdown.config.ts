import { definePluginBuild } from '@10x-media/tsdown-config/tsdown.shared'

export default definePluginBuild({
	entry: {
		index: 'src/index.ts',
		'exports/types': 'src/exports/types.ts',
		'exports/client': 'src/exports/client.ts',
		'exports/rsc': 'src/exports/rsc.ts',
		'exports/i18n': 'src/exports/i18n.ts',
	},
	copy: [
		{
			from: 'src/components/GuideArticle/guide-article.css',
			to: 'dist/components/GuideArticle',
		},
		{
			from: 'src/components/GuideDrawer/guide-drawer.css',
			to: 'dist/components/GuideDrawer',
		},
		{
			from: 'src/components/FieldHelp/field-help.css',
			to: 'dist/components/FieldHelp',
		},
		{
			from: 'src/components/Surfaces/surfaces.css',
			to: 'dist/components/Surfaces',
		},
		{
			from: 'src/components/WikiView/wiki-view.css',
			to: 'dist/components/WikiView',
		},
		{
			from: 'src/components/Video/video.css',
			to: 'dist/components/Video',
		},
		{
			from: 'src/components/BlockHelp/block-help.css',
			to: 'dist/components/BlockHelp',
		},
		{
			from: 'src/components/ListExtras/list-extras.css',
			to: 'dist/components/ListExtras',
		},
	],
})
