/** `req.context` key a server caller sets to author a message as someone other than `req.user`. */
export const AUTHOR_CONTEXT = 'conversationsAuthorKey'

/** The admin group both collections of every instance live under. */
export const ADMIN_GROUP = 'Conversations'

/** The built-in message type: a rich text body. */
export const TEXT_TYPE = 'text'

/** The widget the plugin registers so server slots can ride Payload's `render-widget`. */
export const SLOT_WIDGET_SLUG = '@10x-media/conversations:slot'
