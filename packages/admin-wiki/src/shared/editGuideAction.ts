/**
 * Import-map path of the guide page's header action. The plugin registers it in
 * `admin.dependencies`, since nothing else in the config names it, and the
 * guide view passes it to `DefaultTemplate` as a view action.
 */
export const WIKI_EDIT_GUIDE_ACTION = '@10x-media/admin-wiki/client#WikiEditGuideAction'
