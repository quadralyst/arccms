/**
 * Every key in src/assets/i18n/en.json.
 *
 * GENERATED — do not edit. Run `npm run i18n:keys` after changing en.json.
 *
 * Typing a key parameter with this catches a typo at compile time instead of
 * rendering the key itself to a user. It covers the TypeScript side —
 * `notify.*`, `t()`, table column keys. Keys written in templates as
 * `{{ 'x.y' | transloco }}` are plain strings to the compiler and are not
 * checked; the i18n-parity spec is the backstop for those.
 */

export type TranslationKey =
    | 'admin.audience.contacts.add'
    | 'admin.audience.contacts.any'
    | 'admin.audience.contacts.backfill'
    | 'admin.audience.contacts.consent'
    | 'admin.audience.contacts.empty_description'
    | 'admin.audience.contacts.empty_title'
    | 'admin.audience.contacts.import_csv'
    | 'admin.audience.contacts.lists'
    | 'admin.audience.contacts.pending'
    | 'admin.audience.contacts.search'
    | 'admin.audience.contacts.sources'
    | 'admin.audience.contacts.subscribed'
    | 'admin.audience.contacts.subtitle'
    | 'admin.audience.contacts.tags'
    | 'admin.audience.contacts.title'
    | 'admin.audience.contacts.unsubscribed'
    | 'admin.audience.fields.empty_description'
    | 'admin.audience.fields.empty_title'
    | 'admin.audience.fields.fallback'
    | 'admin.audience.fields.field'
    | 'admin.audience.fields.import'
    | 'admin.audience.fields.merge_tag'
    | 'admin.audience.fields.new'
    | 'admin.audience.fields.on_resubmit'
    | 'admin.audience.fields.subtitle'
    | 'admin.audience.fields.title'
    | 'admin.audience.lists.create'
    | 'admin.audience.lists.empty_description'
    | 'admin.audience.lists.empty_title'
    | 'admin.audience.lists.members'
    | 'admin.audience.lists.subtitle'
    | 'admin.audience.lists.sync'
    | 'admin.audience.lists.title'
    | 'admin.audience.lists.view_form'
    | 'admin.audience.tags.contacts'
    | 'admin.audience.tags.create'
    | 'admin.audience.tags.empty_description'
    | 'admin.audience.tags.empty_title'
    | 'admin.audience.tags.import'
    | 'admin.audience.tags.subtitle'
    | 'admin.audience.tags.tag'
    | 'admin.audience.tags.title'
    | 'admin.audience.tags.view_contacts'
    | 'admin.contents.editor.auto_saved'
    | 'admin.contents.editor.back_to_editor'
    | 'admin.contents.editor.change'
    | 'admin.contents.editor.clear_translation'
    | 'admin.contents.editor.click_to_select_image'
    | 'admin.contents.editor.click_to_upload'
    | 'admin.contents.editor.cover_image'
    | 'admin.contents.editor.custom_fields'
    | 'admin.contents.editor.default_badge'
    | 'admin.contents.editor.deploy_error'
    | 'admin.contents.editor.deploy_failed'
    | 'admin.contents.editor.deployed'
    | 'admin.contents.editor.deployed_success'
    | 'admin.contents.editor.deploying'
    | 'admin.contents.editor.editing_draft'
    | 'admin.contents.editor.expand'
    | 'admin.contents.editor.history'
    | 'admin.contents.editor.image_recommendation'
    | 'admin.contents.editor.loading_options'
    | 'admin.contents.editor.meta_description'
    | 'admin.contents.editor.next_content_hint'
    | 'admin.contents.editor.no_content_found'
    | 'admin.contents.editor.no_cover_image'
    | 'admin.contents.editor.preview'
    | 'admin.contents.editor.publish'
    | 'admin.contents.editor.remove_image'
    | 'admin.contents.editor.restore_version'
    | 'admin.contents.editor.save_draft'
    | 'admin.contents.editor.select_image'
    | 'admin.contents.editor.seo_title'
    | 'admin.contents.editor.shared_badge'
    | 'admin.contents.editor.slug_exists'
    | 'admin.contents.editor.slug_warning'
    | 'admin.contents.editor.social_preview'
    | 'admin.contents.editor.summary'
    | 'admin.contents.editor.summary_hint'
    | 'admin.contents.editor.tab_basic'
    | 'admin.contents.editor.tab_seo'
    | 'admin.contents.editor.tag_create_failed'
    | 'admin.contents.editor.tags'
    | 'admin.contents.editor.tags_placeholder'
    | 'admin.contents.editor.translating_note'
    | 'admin.contents.editor.translation_clear_failed'
    | 'admin.contents.editor.translation_cleared'
    | 'admin.contents.editor.translation_save_failed'
    | 'admin.contents.editor.unknown_error'
    | 'admin.contents.editor.unsaved_changes'
    | 'admin.contents.editor.upload_image'
    | 'admin.contents.editor.url_copied'
    | 'admin.contents.editor.url_copy_failed'
    | 'admin.contents.editor.url_slug'
    | 'admin.contents.editor.version_restored'
    | 'admin.contents.list.add_item'
    | 'admin.contents.list.bulk_import'
    | 'admin.contents.list.col_title'
    | 'admin.contents.list.columns'
    | 'admin.contents.list.delete_failed'
    | 'admin.contents.list.deleted'
    | 'admin.contents.list.go_to_types'
    | 'admin.contents.list.manage_subtitle'
    | 'admin.contents.list.no_type_edit'
    | 'admin.contents.list.no_type_import'
    | 'admin.contents.list.preview'
    | 'admin.contents.list.remove_confirm'
    | 'admin.contents.list.reset_columns'
    | 'admin.contents.list.type_not_found'
    | 'admin.contents.list.unpublish'
    | 'admin.contents.list.unpublish_confirm'
    | 'admin.contents.list.unpublish_failed'
    | 'admin.contents.list.unpublished'
    | 'admin.contents.list.view_history'
    | 'admin.contents.list.view_save_failed'
    | 'admin.contents.list.visible_columns'
    | 'admin.contents.types.add'
    | 'admin.contents.types.col_fields'
    | 'admin.contents.types.col_public_pages'
    | 'admin.contents.types.create_failed'
    | 'admin.contents.types.created'
    | 'admin.contents.types.delete_failed'
    | 'admin.contents.types.deleted'
    | 'admin.contents.types.empty_description'
    | 'admin.contents.types.empty_title'
    | 'admin.contents.types.field_count'
    | 'admin.contents.types.fix_slug'
    | 'admin.contents.types.form.add_field'
    | 'admin.contents.types.form.add_title'
    | 'admin.contents.types.form.custom_field_labels'
    | 'admin.contents.types.form.custom_fields'
    | 'admin.contents.types.form.default_badge'
    | 'admin.contents.types.form.default_template'
    | 'admin.contents.types.form.denormalize'
    | 'admin.contents.types.form.description'
    | 'admin.contents.types.form.description_placeholder'
    | 'admin.contents.types.form.description_translation_hint'
    | 'admin.contents.types.form.display_field'
    | 'admin.contents.types.form.display_field_hint'
    | 'admin.contents.types.form.edit_title'
    | 'admin.contents.types.form.field_key'
    | 'admin.contents.types.form.field_key_placeholder'
    | 'admin.contents.types.form.field_label'
    | 'admin.contents.types.form.field_label_placeholder'
    | 'admin.contents.types.form.field_n'
    | 'admin.contents.types.form.field_required'
    | 'admin.contents.types.form.field_type'
    | 'admin.contents.types.form.icon'
    | 'admin.contents.types.form.icon_search_placeholder'
    | 'admin.contents.types.form.name_hint'
    | 'admin.contents.types.form.name_minlength'
    | 'admin.contents.types.form.name_placeholder'
    | 'admin.contents.types.form.name_plural'
    | 'admin.contents.types.form.name_plural_short'
    | 'admin.contents.types.form.name_required'
    | 'admin.contents.types.form.no_custom_fields'
    | 'admin.contents.types.form.options'
    | 'admin.contents.types.form.options_hint'
    | 'admin.contents.types.form.options_placeholder'
    | 'admin.contents.types.form.public_pages'
    | 'admin.contents.types.form.public_pages_off'
    | 'admin.contents.types.form.save'
    | 'admin.contents.types.form.select_collection'
    | 'admin.contents.types.form.select_display_field'
    | 'admin.contents.types.form.singular_hint'
    | 'admin.contents.types.form.singular_name'
    | 'admin.contents.types.form.singular_placeholder'
    | 'admin.contents.types.form.slug'
    | 'admin.contents.types.form.slug_change_warning'
    | 'admin.contents.types.form.slug_hint'
    | 'admin.contents.types.form.slug_pattern'
    | 'admin.contents.types.form.slug_required'
    | 'admin.contents.types.form.slug_taken'
    | 'admin.contents.types.form.source_collection'
    | 'admin.contents.types.form.template'
    | 'admin.contents.types.form.template_hint'
    | 'admin.contents.types.form.template_loading'
    | 'admin.contents.types.form.translating_into'
    | 'admin.contents.types.form.update'
    | 'admin.contents.types.form.use_collection'
    | 'admin.contents.types.manage_tags'
    | 'admin.contents.types.no_action'
    | 'admin.contents.types.page_subtitle'
    | 'admin.contents.types.page_title'
    | 'admin.contents.types.slug_exists'
    | 'admin.contents.types.update_failed'
    | 'admin.contents.types.updated'
    | 'admin.nav.about'
    | 'admin.nav.announcements'
    | 'admin.nav.audience'
    | 'admin.nav.audience_and_emails'
    | 'admin.nav.brand_kit'
    | 'admin.nav.broadcasts'
    | 'admin.nav.composer'
    | 'admin.nav.contacts'
    | 'admin.nav.content'
    | 'admin.nav.content_types'
    | 'admin.nav.dashboard'
    | 'admin.nav.data'
    | 'admin.nav.drip_campaigns'
    | 'admin.nav.email'
    | 'admin.nav.email_logs'
    | 'admin.nav.email_templates'
    | 'admin.nav.export_data'
    | 'admin.nav.export_files'
    | 'admin.nav.fields'
    | 'admin.nav.import_data'
    | 'admin.nav.import_files'
    | 'admin.nav.lists'
    | 'admin.nav.logout'
    | 'admin.nav.logout_confirm'
    | 'admin.nav.logout_success'
    | 'admin.nav.media_manager'
    | 'admin.nav.products'
    | 'admin.nav.profile'
    | 'admin.nav.settings'
    | 'admin.nav.signup_forms'
    | 'admin.nav.tags'
    | 'admin.nav.transactions'
    | 'admin.nav.users'
    | 'admin.settings.about.address'
    | 'admin.settings.about.address_hint'
    | 'admin.settings.about.address_placeholder'
    | 'admin.settings.about.production_url'
    | 'admin.settings.about.production_url_hint'
    | 'admin.settings.about.production_url_placeholder'
    | 'admin.settings.about.site_name'
    | 'admin.settings.about.site_name_hint'
    | 'admin.settings.about.site_name_placeholder'
    | 'admin.settings.background_style'
    | 'admin.settings.banner_enabled'
    | 'admin.settings.email.at_least_one'
    | 'admin.settings.email.auto_purge'
    | 'admin.settings.email.auto_purge_enable'
    | 'admin.settings.email.auto_purge_hint'
    | 'admin.settings.email.bcc'
    | 'admin.settings.email.bcc_hint'
    | 'admin.settings.email.change_provider'
    | 'admin.settings.email.configure'
    | 'admin.settings.email.debug_hint'
    | 'admin.settings.email.debug_provider'
    | 'admin.settings.email.disabled_title'
    | 'admin.settings.email.done'
    | 'admin.settings.email.enabled'
    | 'admin.settings.email.features'
    | 'admin.settings.email.features_hint'
    | 'admin.settings.email.features_off'
    | 'admin.settings.email.keep_days'
    | 'admin.settings.email.keep_days_hint'
    | 'admin.settings.email.keep_days_range'
    | 'admin.settings.email.per_day'
    | 'admin.settings.email.per_day_hint'
    | 'admin.settings.email.per_hour'
    | 'admin.settings.email.per_hour_hint'
    | 'admin.settings.email.per_second'
    | 'admin.settings.email.per_second_hint'
    | 'admin.settings.email.provider'
    | 'admin.settings.email.rate_hint'
    | 'admin.settings.email.reply_to'
    | 'admin.settings.email.reply_to_hint'
    | 'admin.settings.email.require_verification'
    | 'admin.settings.email.select_provider'
    | 'admin.settings.email.select_provider_hint'
    | 'admin.settings.email.sender_email'
    | 'admin.settings.email.sender_email_hint'
    | 'admin.settings.email.sender_email_locked'
    | 'admin.settings.email.sender_info'
    | 'admin.settings.email.sender_info_hint'
    | 'admin.settings.email.sender_name'
    | 'admin.settings.email.sender_name_hint'
    | 'admin.settings.email.sender_name_placeholder'
    | 'admin.settings.email.subtitle'
    | 'admin.settings.email.test_before_save'
    | 'admin.settings.email.title'
    | 'admin.settings.enable_banner'
    | 'admin.settings.enable_to_configure'
    | 'admin.settings.hub.about.description'
    | 'admin.settings.hub.about.label'
    | 'admin.settings.hub.analytics.description'
    | 'admin.settings.hub.analytics.label'
    | 'admin.settings.hub.email.description'
    | 'admin.settings.hub.email.label'
    | 'admin.settings.hub.integrations.description'
    | 'admin.settings.hub.integrations.label'
    | 'admin.settings.hub.localization.description'
    | 'admin.settings.hub.localization.label'
    | 'admin.settings.hub.message.description'
    | 'admin.settings.hub.message.label'
    | 'admin.settings.hub.misc.description'
    | 'admin.settings.hub.misc.label'
    | 'admin.settings.hub.payments.description'
    | 'admin.settings.hub.payments.label'
    | 'admin.settings.hub.site-usage.description'
    | 'admin.settings.hub.site-usage.label'
    | 'admin.settings.hub.subtitle'
    | 'admin.settings.hub.title'
    | 'admin.settings.hub.user.description'
    | 'admin.settings.hub.user.label'
    | 'admin.settings.live_preview'
    | 'admin.settings.localization.add_a_language'
    | 'admin.settings.localization.already_enabled'
    | 'admin.settings.localization.cannot_remove_default'
    | 'admin.settings.localization.col_code'
    | 'admin.settings.localization.col_default'
    | 'admin.settings.localization.col_language'
    | 'admin.settings.localization.col_order'
    | 'admin.settings.localization.col_url_prefix'
    | 'admin.settings.localization.custom_code'
    | 'admin.settings.localization.custom_code_placeholder'
    | 'admin.settings.localization.custom_name'
    | 'admin.settings.localization.custom_name_placeholder'
    | 'admin.settings.localization.intro_1'
    | 'admin.settings.localization.intro_2'
    | 'admin.settings.localization.intro_default_language'
    | 'admin.settings.localization.invalid_code'
    | 'admin.settings.localization.languages'
    | 'admin.settings.localization.make_default'
    | 'admin.settings.localization.move_down'
    | 'admin.settings.localization.move_up'
    | 'admin.settings.localization.other_enter_code'
    | 'admin.settings.localization.removal_note'
    | 'admin.settings.localization.remove_language'
    | 'admin.settings.localization.root_prefix'
    | 'admin.settings.localization.save_failed'
    | 'admin.settings.localization.save_languages'
    | 'admin.settings.localization.saved'
    | 'admin.settings.localization.select_a_language'
    | 'admin.settings.localization.title'
    | 'admin.settings.localization.unresolved_language'
    | 'admin.settings.message.button_label'
    | 'admin.settings.message.button_label_placeholder'
    | 'admin.settings.message.button_url'
    | 'admin.settings.message.button_url_placeholder'
    | 'admin.settings.message.configure'
    | 'admin.settings.message.heading'
    | 'admin.settings.message.heading_placeholder'
    | 'admin.settings.message.heading_required'
    | 'admin.settings.message.message'
    | 'admin.settings.message.message_placeholder'
    | 'admin.settings.message.message_required'
    | 'admin.settings.message.subtitle'
    | 'admin.settings.message.title'
    | 'admin.settings.misc.branding'
    | 'admin.settings.misc.branding_hint'
    | 'admin.settings.misc.branding_saved'
    | 'admin.settings.misc.convert_webp'
    | 'admin.settings.misc.max_file_size'
    | 'admin.settings.misc.max_file_size_hint'
    | 'admin.settings.misc.max_height'
    | 'admin.settings.misc.max_height_hint'
    | 'admin.settings.misc.max_width'
    | 'admin.settings.misc.max_width_hint'
    | 'admin.settings.misc.media_saved'
    | 'admin.settings.misc.media_upload'
    | 'admin.settings.misc.powered_by'
    | 'admin.settings.misc.save_branding'
    | 'admin.settings.misc.save_media'
    | 'admin.settings.site_usage.accept_placeholder'
    | 'admin.settings.site_usage.accept_text'
    | 'admin.settings.site_usage.accept_text_required'
    | 'admin.settings.site_usage.banner_message'
    | 'admin.settings.site_usage.banner_message_placeholder'
    | 'admin.settings.site_usage.banner_message_required'
    | 'admin.settings.site_usage.configure'
    | 'admin.settings.site_usage.learn_more'
    | 'admin.settings.site_usage.policy_link'
    | 'admin.settings.site_usage.policy_link_hint'
    | 'admin.settings.site_usage.policy_placeholder'
    | 'admin.settings.site_usage.reject_placeholder'
    | 'admin.settings.site_usage.reject_text'
    | 'admin.settings.site_usage.reject_text_required'
    | 'admin.settings.site_usage.subtitle'
    | 'admin.settings.site_usage.title'
    | 'admin.settings.user.assigned_note'
    | 'admin.settings.user.assigned_note_end'
    | 'admin.settings.user.default_role'
    | 'admin.settings.user.default_role_hint'
    | 'admin.settings.user.enable'
    | 'admin.settings.user.enable_signups'
    | 'admin.settings.user.enable_signups_hint'
    | 'admin.settings.user.signups_disabled'
    | 'admin.settings.user.subtitle'
    | 'admin.settings.user.title'
    | 'admin.users.add'
    | 'admin.users.empty_description'
    | 'admin.users.empty_title'
    | 'admin.users.invalid_action'
    | 'admin.users.none_selected'
    | 'admin.users.page_subtitle'
    | 'admin.users.page_title'
    | 'admin.users.verify'
    | 'common.actions.add'
    | 'common.actions.back'
    | 'common.actions.cancel'
    | 'common.actions.close'
    | 'common.actions.confirm'
    | 'common.actions.delete'
    | 'common.actions.delete_confirm'
    | 'common.actions.edit'
    | 'common.actions.enable'
    | 'common.actions.logout'
    | 'common.actions.open'
    | 'common.actions.remove'
    | 'common.actions.reset'
    | 'common.actions.save'
    | 'common.actions.save_settings'
    | 'common.actions.saving'
    | 'common.actions.search'
    | 'common.actions.view'
    | 'common.dialog.confirm'
    | 'common.dialog.delete'
    | 'common.dialog.logout'
    | 'common.dialog.unpublish'
    | 'common.filters.all'
    | 'common.filters.clear'
    | 'common.filters.filtered'
    | 'common.filters.status'
    | 'common.language.admin_ui'
    | 'common.language.hint'
    | 'common.messages.save_failed'
    | 'common.messages.saved'
    | 'common.no'
    | 'common.optional'
    | 'common.paginator.first_page'
    | 'common.paginator.items_per_page'
    | 'common.paginator.last_page'
    | 'common.paginator.next_page'
    | 'common.paginator.previous_page'
    | 'common.paginator.range'
    | 'common.paginator.range_empty'
    | 'common.state.loading'
    | 'common.status.draft'
    | 'common.status.edited'
    | 'common.status.featured'
    | 'common.status.published'
    | 'common.status.tooltip.draft'
    | 'common.status.tooltip.edited'
    | 'common.status.tooltip.published'
    | 'common.table.actions'
    | 'common.table.description'
    | 'common.table.email'
    | 'common.table.id'
    | 'common.table.index'
    | 'common.table.joined'
    | 'common.table.last_updated'
    | 'common.table.name'
    | 'common.table.no_records'
    | 'common.table.role'
    | 'common.table.showing_range'
    | 'common.table.showing_range_filtered'
    | 'common.table.slug'
    | 'common.table.status'
    | 'common.table.type'
    | 'common.validation.generic'
    | 'common.validation.maxlength'
    | 'common.validation.minlength'
    | 'common.validation.required'
    | 'common.yes';

/** The same list at runtime, for the parity spec and for validation. */
export const TRANSLATION_KEYS: readonly TranslationKey[] = [
    'admin.audience.contacts.add',
    'admin.audience.contacts.any',
    'admin.audience.contacts.backfill',
    'admin.audience.contacts.consent',
    'admin.audience.contacts.empty_description',
    'admin.audience.contacts.empty_title',
    'admin.audience.contacts.import_csv',
    'admin.audience.contacts.lists',
    'admin.audience.contacts.pending',
    'admin.audience.contacts.search',
    'admin.audience.contacts.sources',
    'admin.audience.contacts.subscribed',
    'admin.audience.contacts.subtitle',
    'admin.audience.contacts.tags',
    'admin.audience.contacts.title',
    'admin.audience.contacts.unsubscribed',
    'admin.audience.fields.empty_description',
    'admin.audience.fields.empty_title',
    'admin.audience.fields.fallback',
    'admin.audience.fields.field',
    'admin.audience.fields.import',
    'admin.audience.fields.merge_tag',
    'admin.audience.fields.new',
    'admin.audience.fields.on_resubmit',
    'admin.audience.fields.subtitle',
    'admin.audience.fields.title',
    'admin.audience.lists.create',
    'admin.audience.lists.empty_description',
    'admin.audience.lists.empty_title',
    'admin.audience.lists.members',
    'admin.audience.lists.subtitle',
    'admin.audience.lists.sync',
    'admin.audience.lists.title',
    'admin.audience.lists.view_form',
    'admin.audience.tags.contacts',
    'admin.audience.tags.create',
    'admin.audience.tags.empty_description',
    'admin.audience.tags.empty_title',
    'admin.audience.tags.import',
    'admin.audience.tags.subtitle',
    'admin.audience.tags.tag',
    'admin.audience.tags.title',
    'admin.audience.tags.view_contacts',
    'admin.contents.editor.auto_saved',
    'admin.contents.editor.back_to_editor',
    'admin.contents.editor.change',
    'admin.contents.editor.clear_translation',
    'admin.contents.editor.click_to_select_image',
    'admin.contents.editor.click_to_upload',
    'admin.contents.editor.cover_image',
    'admin.contents.editor.custom_fields',
    'admin.contents.editor.default_badge',
    'admin.contents.editor.deploy_error',
    'admin.contents.editor.deploy_failed',
    'admin.contents.editor.deployed',
    'admin.contents.editor.deployed_success',
    'admin.contents.editor.deploying',
    'admin.contents.editor.editing_draft',
    'admin.contents.editor.expand',
    'admin.contents.editor.history',
    'admin.contents.editor.image_recommendation',
    'admin.contents.editor.loading_options',
    'admin.contents.editor.meta_description',
    'admin.contents.editor.next_content_hint',
    'admin.contents.editor.no_content_found',
    'admin.contents.editor.no_cover_image',
    'admin.contents.editor.preview',
    'admin.contents.editor.publish',
    'admin.contents.editor.remove_image',
    'admin.contents.editor.restore_version',
    'admin.contents.editor.save_draft',
    'admin.contents.editor.select_image',
    'admin.contents.editor.seo_title',
    'admin.contents.editor.shared_badge',
    'admin.contents.editor.slug_exists',
    'admin.contents.editor.slug_warning',
    'admin.contents.editor.social_preview',
    'admin.contents.editor.summary',
    'admin.contents.editor.summary_hint',
    'admin.contents.editor.tab_basic',
    'admin.contents.editor.tab_seo',
    'admin.contents.editor.tag_create_failed',
    'admin.contents.editor.tags',
    'admin.contents.editor.tags_placeholder',
    'admin.contents.editor.translating_note',
    'admin.contents.editor.translation_clear_failed',
    'admin.contents.editor.translation_cleared',
    'admin.contents.editor.translation_save_failed',
    'admin.contents.editor.unknown_error',
    'admin.contents.editor.unsaved_changes',
    'admin.contents.editor.upload_image',
    'admin.contents.editor.url_copied',
    'admin.contents.editor.url_copy_failed',
    'admin.contents.editor.url_slug',
    'admin.contents.editor.version_restored',
    'admin.contents.list.add_item',
    'admin.contents.list.bulk_import',
    'admin.contents.list.col_title',
    'admin.contents.list.columns',
    'admin.contents.list.delete_failed',
    'admin.contents.list.deleted',
    'admin.contents.list.go_to_types',
    'admin.contents.list.manage_subtitle',
    'admin.contents.list.no_type_edit',
    'admin.contents.list.no_type_import',
    'admin.contents.list.preview',
    'admin.contents.list.remove_confirm',
    'admin.contents.list.reset_columns',
    'admin.contents.list.type_not_found',
    'admin.contents.list.unpublish',
    'admin.contents.list.unpublish_confirm',
    'admin.contents.list.unpublish_failed',
    'admin.contents.list.unpublished',
    'admin.contents.list.view_history',
    'admin.contents.list.view_save_failed',
    'admin.contents.list.visible_columns',
    'admin.contents.types.add',
    'admin.contents.types.col_fields',
    'admin.contents.types.col_public_pages',
    'admin.contents.types.create_failed',
    'admin.contents.types.created',
    'admin.contents.types.delete_failed',
    'admin.contents.types.deleted',
    'admin.contents.types.empty_description',
    'admin.contents.types.empty_title',
    'admin.contents.types.field_count',
    'admin.contents.types.fix_slug',
    'admin.contents.types.form.add_field',
    'admin.contents.types.form.add_title',
    'admin.contents.types.form.custom_field_labels',
    'admin.contents.types.form.custom_fields',
    'admin.contents.types.form.default_badge',
    'admin.contents.types.form.default_template',
    'admin.contents.types.form.denormalize',
    'admin.contents.types.form.description',
    'admin.contents.types.form.description_placeholder',
    'admin.contents.types.form.description_translation_hint',
    'admin.contents.types.form.display_field',
    'admin.contents.types.form.display_field_hint',
    'admin.contents.types.form.edit_title',
    'admin.contents.types.form.field_key',
    'admin.contents.types.form.field_key_placeholder',
    'admin.contents.types.form.field_label',
    'admin.contents.types.form.field_label_placeholder',
    'admin.contents.types.form.field_n',
    'admin.contents.types.form.field_required',
    'admin.contents.types.form.field_type',
    'admin.contents.types.form.icon',
    'admin.contents.types.form.icon_search_placeholder',
    'admin.contents.types.form.name_hint',
    'admin.contents.types.form.name_minlength',
    'admin.contents.types.form.name_placeholder',
    'admin.contents.types.form.name_plural',
    'admin.contents.types.form.name_plural_short',
    'admin.contents.types.form.name_required',
    'admin.contents.types.form.no_custom_fields',
    'admin.contents.types.form.options',
    'admin.contents.types.form.options_hint',
    'admin.contents.types.form.options_placeholder',
    'admin.contents.types.form.public_pages',
    'admin.contents.types.form.public_pages_off',
    'admin.contents.types.form.save',
    'admin.contents.types.form.select_collection',
    'admin.contents.types.form.select_display_field',
    'admin.contents.types.form.singular_hint',
    'admin.contents.types.form.singular_name',
    'admin.contents.types.form.singular_placeholder',
    'admin.contents.types.form.slug',
    'admin.contents.types.form.slug_change_warning',
    'admin.contents.types.form.slug_hint',
    'admin.contents.types.form.slug_pattern',
    'admin.contents.types.form.slug_required',
    'admin.contents.types.form.slug_taken',
    'admin.contents.types.form.source_collection',
    'admin.contents.types.form.template',
    'admin.contents.types.form.template_hint',
    'admin.contents.types.form.template_loading',
    'admin.contents.types.form.translating_into',
    'admin.contents.types.form.update',
    'admin.contents.types.form.use_collection',
    'admin.contents.types.manage_tags',
    'admin.contents.types.no_action',
    'admin.contents.types.page_subtitle',
    'admin.contents.types.page_title',
    'admin.contents.types.slug_exists',
    'admin.contents.types.update_failed',
    'admin.contents.types.updated',
    'admin.nav.about',
    'admin.nav.announcements',
    'admin.nav.audience',
    'admin.nav.audience_and_emails',
    'admin.nav.brand_kit',
    'admin.nav.broadcasts',
    'admin.nav.composer',
    'admin.nav.contacts',
    'admin.nav.content',
    'admin.nav.content_types',
    'admin.nav.dashboard',
    'admin.nav.data',
    'admin.nav.drip_campaigns',
    'admin.nav.email',
    'admin.nav.email_logs',
    'admin.nav.email_templates',
    'admin.nav.export_data',
    'admin.nav.export_files',
    'admin.nav.fields',
    'admin.nav.import_data',
    'admin.nav.import_files',
    'admin.nav.lists',
    'admin.nav.logout',
    'admin.nav.logout_confirm',
    'admin.nav.logout_success',
    'admin.nav.media_manager',
    'admin.nav.products',
    'admin.nav.profile',
    'admin.nav.settings',
    'admin.nav.signup_forms',
    'admin.nav.tags',
    'admin.nav.transactions',
    'admin.nav.users',
    'admin.settings.about.address',
    'admin.settings.about.address_hint',
    'admin.settings.about.address_placeholder',
    'admin.settings.about.production_url',
    'admin.settings.about.production_url_hint',
    'admin.settings.about.production_url_placeholder',
    'admin.settings.about.site_name',
    'admin.settings.about.site_name_hint',
    'admin.settings.about.site_name_placeholder',
    'admin.settings.background_style',
    'admin.settings.banner_enabled',
    'admin.settings.email.at_least_one',
    'admin.settings.email.auto_purge',
    'admin.settings.email.auto_purge_enable',
    'admin.settings.email.auto_purge_hint',
    'admin.settings.email.bcc',
    'admin.settings.email.bcc_hint',
    'admin.settings.email.change_provider',
    'admin.settings.email.configure',
    'admin.settings.email.debug_hint',
    'admin.settings.email.debug_provider',
    'admin.settings.email.disabled_title',
    'admin.settings.email.done',
    'admin.settings.email.enabled',
    'admin.settings.email.features',
    'admin.settings.email.features_hint',
    'admin.settings.email.features_off',
    'admin.settings.email.keep_days',
    'admin.settings.email.keep_days_hint',
    'admin.settings.email.keep_days_range',
    'admin.settings.email.per_day',
    'admin.settings.email.per_day_hint',
    'admin.settings.email.per_hour',
    'admin.settings.email.per_hour_hint',
    'admin.settings.email.per_second',
    'admin.settings.email.per_second_hint',
    'admin.settings.email.provider',
    'admin.settings.email.rate_hint',
    'admin.settings.email.reply_to',
    'admin.settings.email.reply_to_hint',
    'admin.settings.email.require_verification',
    'admin.settings.email.select_provider',
    'admin.settings.email.select_provider_hint',
    'admin.settings.email.sender_email',
    'admin.settings.email.sender_email_hint',
    'admin.settings.email.sender_email_locked',
    'admin.settings.email.sender_info',
    'admin.settings.email.sender_info_hint',
    'admin.settings.email.sender_name',
    'admin.settings.email.sender_name_hint',
    'admin.settings.email.sender_name_placeholder',
    'admin.settings.email.subtitle',
    'admin.settings.email.test_before_save',
    'admin.settings.email.title',
    'admin.settings.enable_banner',
    'admin.settings.enable_to_configure',
    'admin.settings.hub.about.description',
    'admin.settings.hub.about.label',
    'admin.settings.hub.analytics.description',
    'admin.settings.hub.analytics.label',
    'admin.settings.hub.email.description',
    'admin.settings.hub.email.label',
    'admin.settings.hub.integrations.description',
    'admin.settings.hub.integrations.label',
    'admin.settings.hub.localization.description',
    'admin.settings.hub.localization.label',
    'admin.settings.hub.message.description',
    'admin.settings.hub.message.label',
    'admin.settings.hub.misc.description',
    'admin.settings.hub.misc.label',
    'admin.settings.hub.payments.description',
    'admin.settings.hub.payments.label',
    'admin.settings.hub.site-usage.description',
    'admin.settings.hub.site-usage.label',
    'admin.settings.hub.subtitle',
    'admin.settings.hub.title',
    'admin.settings.hub.user.description',
    'admin.settings.hub.user.label',
    'admin.settings.live_preview',
    'admin.settings.localization.add_a_language',
    'admin.settings.localization.already_enabled',
    'admin.settings.localization.cannot_remove_default',
    'admin.settings.localization.col_code',
    'admin.settings.localization.col_default',
    'admin.settings.localization.col_language',
    'admin.settings.localization.col_order',
    'admin.settings.localization.col_url_prefix',
    'admin.settings.localization.custom_code',
    'admin.settings.localization.custom_code_placeholder',
    'admin.settings.localization.custom_name',
    'admin.settings.localization.custom_name_placeholder',
    'admin.settings.localization.intro_1',
    'admin.settings.localization.intro_2',
    'admin.settings.localization.intro_default_language',
    'admin.settings.localization.invalid_code',
    'admin.settings.localization.languages',
    'admin.settings.localization.make_default',
    'admin.settings.localization.move_down',
    'admin.settings.localization.move_up',
    'admin.settings.localization.other_enter_code',
    'admin.settings.localization.removal_note',
    'admin.settings.localization.remove_language',
    'admin.settings.localization.root_prefix',
    'admin.settings.localization.save_failed',
    'admin.settings.localization.save_languages',
    'admin.settings.localization.saved',
    'admin.settings.localization.select_a_language',
    'admin.settings.localization.title',
    'admin.settings.localization.unresolved_language',
    'admin.settings.message.button_label',
    'admin.settings.message.button_label_placeholder',
    'admin.settings.message.button_url',
    'admin.settings.message.button_url_placeholder',
    'admin.settings.message.configure',
    'admin.settings.message.heading',
    'admin.settings.message.heading_placeholder',
    'admin.settings.message.heading_required',
    'admin.settings.message.message',
    'admin.settings.message.message_placeholder',
    'admin.settings.message.message_required',
    'admin.settings.message.subtitle',
    'admin.settings.message.title',
    'admin.settings.misc.branding',
    'admin.settings.misc.branding_hint',
    'admin.settings.misc.branding_saved',
    'admin.settings.misc.convert_webp',
    'admin.settings.misc.max_file_size',
    'admin.settings.misc.max_file_size_hint',
    'admin.settings.misc.max_height',
    'admin.settings.misc.max_height_hint',
    'admin.settings.misc.max_width',
    'admin.settings.misc.max_width_hint',
    'admin.settings.misc.media_saved',
    'admin.settings.misc.media_upload',
    'admin.settings.misc.powered_by',
    'admin.settings.misc.save_branding',
    'admin.settings.misc.save_media',
    'admin.settings.site_usage.accept_placeholder',
    'admin.settings.site_usage.accept_text',
    'admin.settings.site_usage.accept_text_required',
    'admin.settings.site_usage.banner_message',
    'admin.settings.site_usage.banner_message_placeholder',
    'admin.settings.site_usage.banner_message_required',
    'admin.settings.site_usage.configure',
    'admin.settings.site_usage.learn_more',
    'admin.settings.site_usage.policy_link',
    'admin.settings.site_usage.policy_link_hint',
    'admin.settings.site_usage.policy_placeholder',
    'admin.settings.site_usage.reject_placeholder',
    'admin.settings.site_usage.reject_text',
    'admin.settings.site_usage.reject_text_required',
    'admin.settings.site_usage.subtitle',
    'admin.settings.site_usage.title',
    'admin.settings.user.assigned_note',
    'admin.settings.user.assigned_note_end',
    'admin.settings.user.default_role',
    'admin.settings.user.default_role_hint',
    'admin.settings.user.enable',
    'admin.settings.user.enable_signups',
    'admin.settings.user.enable_signups_hint',
    'admin.settings.user.signups_disabled',
    'admin.settings.user.subtitle',
    'admin.settings.user.title',
    'admin.users.add',
    'admin.users.empty_description',
    'admin.users.empty_title',
    'admin.users.invalid_action',
    'admin.users.none_selected',
    'admin.users.page_subtitle',
    'admin.users.page_title',
    'admin.users.verify',
    'common.actions.add',
    'common.actions.back',
    'common.actions.cancel',
    'common.actions.close',
    'common.actions.confirm',
    'common.actions.delete',
    'common.actions.delete_confirm',
    'common.actions.edit',
    'common.actions.enable',
    'common.actions.logout',
    'common.actions.open',
    'common.actions.remove',
    'common.actions.reset',
    'common.actions.save',
    'common.actions.save_settings',
    'common.actions.saving',
    'common.actions.search',
    'common.actions.view',
    'common.dialog.confirm',
    'common.dialog.delete',
    'common.dialog.logout',
    'common.dialog.unpublish',
    'common.filters.all',
    'common.filters.clear',
    'common.filters.filtered',
    'common.filters.status',
    'common.language.admin_ui',
    'common.language.hint',
    'common.messages.save_failed',
    'common.messages.saved',
    'common.no',
    'common.optional',
    'common.paginator.first_page',
    'common.paginator.items_per_page',
    'common.paginator.last_page',
    'common.paginator.next_page',
    'common.paginator.previous_page',
    'common.paginator.range',
    'common.paginator.range_empty',
    'common.state.loading',
    'common.status.draft',
    'common.status.edited',
    'common.status.featured',
    'common.status.published',
    'common.status.tooltip.draft',
    'common.status.tooltip.edited',
    'common.status.tooltip.published',
    'common.table.actions',
    'common.table.description',
    'common.table.email',
    'common.table.id',
    'common.table.index',
    'common.table.joined',
    'common.table.last_updated',
    'common.table.name',
    'common.table.no_records',
    'common.table.role',
    'common.table.showing_range',
    'common.table.showing_range_filtered',
    'common.table.slug',
    'common.table.status',
    'common.table.type',
    'common.validation.generic',
    'common.validation.maxlength',
    'common.validation.minlength',
    'common.validation.required',
    'common.yes',
];
