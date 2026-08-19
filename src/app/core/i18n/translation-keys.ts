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
    | 'admin.contents.editor.click_to_select_icon'
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
    | 'admin.contents.editor.repeater.add'
    | 'admin.contents.editor.repeater.choose_media'
    | 'admin.contents.editor.repeater.empty'
    | 'admin.contents.editor.repeater.image'
    | 'admin.contents.editor.repeater.position'
    | 'admin.contents.editor.restore_version'
    | 'admin.contents.editor.save_draft'
    | 'admin.contents.editor.select_icon'
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
    | 'admin.dashboard.active'
    | 'admin.dashboard.col_date'
    | 'admin.dashboard.col_details'
    | 'admin.dashboard.col_referrals'
    | 'admin.dashboard.col_waitlist'
    | 'admin.dashboard.configure_email'
    | 'admin.dashboard.connect'
    | 'admin.dashboard.content_media'
    | 'admin.dashboard.count_draft'
    | 'admin.dashboard.count_published'
    | 'admin.dashboard.count_this_week'
    | 'admin.dashboard.debug_banner'
    | 'admin.dashboard.debug_provider_active'
    | 'admin.dashboard.email_disabled_note'
    | 'admin.dashboard.email_not_configured'
    | 'admin.dashboard.email_settings'
    | 'admin.dashboard.firebase_console_note'
    | 'admin.dashboard.ga_not_connected'
    | 'admin.dashboard.ga_overview'
    | 'admin.dashboard.ga_setup_hint'
    | 'admin.dashboard.growth_leads'
    | 'admin.dashboard.inactive'
    | 'admin.dashboard.last_sync'
    | 'admin.dashboard.media'
    | 'admin.dashboard.media_files'
    | 'admin.dashboard.no_analytics_yet'
    | 'admin.dashboard.no_data'
    | 'admin.dashboard.no_recent_activity'
    | 'admin.dashboard.no_recent_signups'
    | 'admin.dashboard.property_account'
    | 'admin.dashboard.property_intro'
    | 'admin.dashboard.property_title'
    | 'admin.dashboard.recent_activity'
    | 'admin.dashboard.recent_signups'
    | 'admin.dashboard.refresh'
    | 'admin.dashboard.refresh_failed'
    | 'admin.dashboard.refreshing'
    | 'admin.dashboard.setup_analytics'
    | 'admin.dashboard.this_week'
    | 'admin.dashboard.title'
    | 'admin.dashboard.total_signups'
    | 'admin.dashboard.view_all'
    | 'admin.dashboard.view_full_analytics'
    | 'admin.data.export.bundle_badge'
    | 'admin.data.export.collections_selected'
    | 'admin.data.export.complete'
    | 'admin.data.export.drafts'
    | 'admin.data.export.export_selected'
    | 'admin.data.export.exporting'
    | 'admin.data.export.failed'
    | 'admin.data.export.progress'
    | 'admin.data.export.progress_detail'
    | 'admin.data.export.published'
    | 'admin.data.export.subtitle'
    | 'admin.data.export.tags'
    | 'admin.data.export.title'
    | 'admin.data.export_files.download_zip'
    | 'admin.data.export_files.downloading'
    | 'admin.data.export_files.failed'
    | 'admin.data.export_files.loading'
    | 'admin.data.export_files.none'
    | 'admin.data.export_files.of_selected'
    | 'admin.data.export_files.progress'
    | 'admin.data.export_files.select_all'
    | 'admin.data.export_files.subtitle'
    | 'admin.data.export_files.title'
    | 'admin.data.group_audience'
    | 'admin.data.group_content'
    | 'admin.data.group_email'
    | 'admin.data.group_settings'
    | 'admin.data.group_users'
    | 'admin.data.import.back'
    | 'admin.data.import.browse'
    | 'admin.data.import.complete'
    | 'admin.data.import.counts'
    | 'admin.data.import.drag_drop'
    | 'admin.data.import.error_details'
    | 'admin.data.import.errors'
    | 'admin.data.import.failed'
    | 'admin.data.import.import_selected'
    | 'admin.data.import.imported'
    | 'admin.data.import.importing'
    | 'admin.data.import.merge'
    | 'admin.data.import.new_import'
    | 'admin.data.import.on_conflict'
    | 'admin.data.import.overwrite'
    | 'admin.data.import.per_collection'
    | 'admin.data.import.preview_title'
    | 'admin.data.import.progress_title'
    | 'admin.data.import.select_all'
    | 'admin.data.import.skip'
    | 'admin.data.import.skipped'
    | 'admin.data.import.step_import'
    | 'admin.data.import.step_preview'
    | 'admin.data.import.step_upload'
    | 'admin.data.import.summary'
    | 'admin.data.import.upload_hint'
    | 'admin.data.import.upload_title'
    | 'admin.data.import.version_collections'
    | 'admin.data.import.warnings'
    | 'admin.data.import_files.complete'
    | 'admin.data.import_files.drag_drop'
    | 'admin.data.import_files.entries_found'
    | 'admin.data.import_files.failed_count'
    | 'admin.data.import_files.files_selected'
    | 'admin.data.import_files.invalid_manifest'
    | 'admin.data.import_files.manifest'
    | 'admin.data.import_files.manifest_hint'
    | 'admin.data.import_files.new_upload'
    | 'admin.data.import_files.path_prefix'
    | 'admin.data.import_files.restore'
    | 'admin.data.import_files.restore_failed'
    | 'admin.data.import_files.subtitle'
    | 'admin.data.import_files.successful'
    | 'admin.data.import_files.title'
    | 'admin.data.import_files.update_metadata'
    | 'admin.data.import_files.upload'
    | 'admin.data.import_files.upload_failed'
    | 'admin.data.import_files.upload_n'
    | 'admin.data.import_files.upload_new'
    | 'admin.data.import_files.uploading'
    | 'admin.data.import_files.uploading_progress'
    | 'admin.data.other_collections'
    | 'admin.data.preset_all_content'
    | 'admin.data.preset_all_settings'
    | 'admin.data.preset_everything'
    | 'admin.data.subtitle'
    | 'admin.data.title'
    | 'admin.media.api_hint'
    | 'admin.media.api_not_configured'
    | 'admin.media.configure_api'
    | 'admin.media.delete_failed'
    | 'admin.media.dimensions'
    | 'admin.media.drop_hint'
    | 'admin.media.empty'
    | 'admin.media.icons.insert'
    | 'admin.media.icons.load_failed'
    | 'admin.media.icons.loading'
    | 'admin.media.icons.name_label'
    | 'admin.media.icons.no_results'
    | 'admin.media.icons.none_selected'
    | 'admin.media.icons.search_placeholder'
    | 'admin.media.icons.selected'
    | 'admin.media.icons.show_more'
    | 'admin.media.icons.showing'
    | 'admin.media.icons.style_all'
    | 'admin.media.icons.style_brands'
    | 'admin.media.icons.style_filter'
    | 'admin.media.icons.style_label'
    | 'admin.media.icons.style_regular'
    | 'admin.media.icons.style_solid'
    | 'admin.media.icons.tab'
    | 'admin.media.insert'
    | 'admin.media.load_failed'
    | 'admin.media.logo_alt'
    | 'admin.media.metadata_failed'
    | 'admin.media.open_full'
    | 'admin.media.search_failed'
    | 'admin.media.search_placeholder'
    | 'admin.media.searching'
    | 'admin.media.select_page'
    | 'admin.media.selected'
    | 'admin.media.selected_image_alt'
    | 'admin.media.supports'
    | 'admin.media.upload_new'
    | 'admin.media.uploaded'
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
    | 'admin.products.active'
    | 'admin.products.add_tier'
    | 'admin.products.code'
    | 'admin.products.code_note'
    | 'admin.products.confirmed_sales'
    | 'admin.products.copy_failed'
    | 'admin.products.copy_link'
    | 'admin.products.create_failed'
    | 'admin.products.created'
    | 'admin.products.created_toast'
    | 'admin.products.credits'
    | 'admin.products.credits_hint'
    | 'admin.products.currency'
    | 'admin.products.days'
    | 'admin.products.delete_failed'
    | 'admin.products.deleted'
    | 'admin.products.description'
    | 'admin.products.discount_code'
    | 'admin.products.display_only'
    | 'admin.products.dodo_id'
    | 'admin.products.features'
    | 'admin.products.generate'
    | 'admin.products.generating'
    | 'admin.products.grandfathering'
    | 'admin.products.grandfathering_note'
    | 'admin.products.higher_more_access'
    | 'admin.products.inactive'
    | 'admin.products.interval'
    | 'admin.products.label'
    | 'admin.products.limit'
    | 'admin.products.link_copied'
    | 'admin.products.link_failed'
    | 'admin.products.link_note'
    | 'admin.products.list_price'
    | 'admin.products.monthly'
    | 'admin.products.name'
    | 'admin.products.new'
    | 'admin.products.no_checkout_url'
    | 'admin.products.no_tiers'
    | 'admin.products.none'
    | 'admin.products.none_value'
    | 'admin.products.off'
    | 'admin.products.off_percent'
    | 'admin.products.one_time'
    | 'admin.products.open_new_tab'
    | 'admin.products.premium_type'
    | 'admin.products.price'
    | 'admin.products.pricing_tiers'
    | 'admin.products.rank_hint'
    | 'admin.products.save'
    | 'admin.products.sold'
    | 'admin.products.subscription'
    | 'admin.products.subtitle'
    | 'admin.products.test_link'
    | 'admin.products.tier'
    | 'admin.products.tier_note'
    | 'admin.products.tier_rank'
    | 'admin.products.title'
    | 'admin.products.trial'
    | 'admin.products.trial_days'
    | 'admin.products.type'
    | 'admin.products.update_failed'
    | 'admin.products.updated'
    | 'admin.products.updates_hint'
    | 'admin.products.updates_years'
    | 'admin.products.view_details'
    | 'admin.products.yearly'
    | 'admin.settings.about.address'
    | 'admin.settings.about.address_hint'
    | 'admin.settings.about.address_placeholder'
    | 'admin.settings.about.intro'
    | 'admin.settings.about.production_url'
    | 'admin.settings.about.production_url_hint'
    | 'admin.settings.about.production_url_placeholder'
    | 'admin.settings.about.site_name'
    | 'admin.settings.about.site_name_hint'
    | 'admin.settings.about.site_name_placeholder'
    | 'admin.settings.analytics.client_id'
    | 'admin.settings.analytics.client_id_placeholder'
    | 'admin.settings.analytics.client_id_required'
    | 'admin.settings.analytics.client_secret'
    | 'admin.settings.analytics.client_secret_placeholder'
    | 'admin.settings.analytics.client_secret_required'
    | 'admin.settings.analytics.configure'
    | 'admin.settings.analytics.configured'
    | 'admin.settings.analytics.connect_button'
    | 'admin.settings.analytics.connect_failed'
    | 'admin.settings.analytics.connect_intro'
    | 'admin.settings.analytics.connect_success'
    | 'admin.settings.analytics.connected'
    | 'admin.settings.analytics.connected_to'
    | 'admin.settings.analytics.connecting'
    | 'admin.settings.analytics.connection'
    | 'admin.settings.analytics.copied'
    | 'admin.settings.analytics.copy_failed'
    | 'admin.settings.analytics.creds_hint'
    | 'admin.settings.analytics.creds_save_failed'
    | 'admin.settings.analytics.creds_saved'
    | 'admin.settings.analytics.disconnect'
    | 'admin.settings.analytics.disconnect_failed'
    | 'admin.settings.analytics.disconnected'
    | 'admin.settings.analytics.disconnecting'
    | 'admin.settings.analytics.guide'
    | 'admin.settings.analytics.intro'
    | 'admin.settings.analytics.live_site'
    | 'admin.settings.analytics.local_dev'
    | 'admin.settings.analytics.not_connected'
    | 'admin.settings.analytics.oauth_credentials'
    | 'admin.settings.analytics.property'
    | 'admin.settings.analytics.required_by_google'
    | 'admin.settings.analytics.s1_a'
    | 'admin.settings.analytics.s1_b'
    | 'admin.settings.analytics.s1_c'
    | 'admin.settings.analytics.s1_d'
    | 'admin.settings.analytics.s1_e'
    | 'admin.settings.analytics.s1_title'
    | 'admin.settings.analytics.s2_a'
    | 'admin.settings.analytics.s2_b'
    | 'admin.settings.analytics.s2_c'
    | 'admin.settings.analytics.s2_c1'
    | 'admin.settings.analytics.s2_c2'
    | 'admin.settings.analytics.s2_c3'
    | 'admin.settings.analytics.s2_c4'
    | 'admin.settings.analytics.s2_d'
    | 'admin.settings.analytics.s2_e'
    | 'admin.settings.analytics.s2_f'
    | 'admin.settings.analytics.s2_g'
    | 'admin.settings.analytics.s2_h'
    | 'admin.settings.analytics.s2_i'
    | 'admin.settings.analytics.s2_j'
    | 'admin.settings.analytics.s2_title'
    | 'admin.settings.analytics.s3_a'
    | 'admin.settings.analytics.s3_b'
    | 'admin.settings.analytics.s3_c'
    | 'admin.settings.analytics.s3_d'
    | 'admin.settings.analytics.s3_title'
    | 'admin.settings.analytics.same_account'
    | 'admin.settings.analytics.save_credentials'
    | 'admin.settings.analytics.save_creds_first'
    | 'admin.settings.analytics.save_first'
    | 'admin.settings.analytics.saved_hint'
    | 'admin.settings.analytics.select_property_failed'
    | 'admin.settings.analytics.subtitle'
    | 'admin.settings.analytics.title'
    | 'admin.settings.analytics.why_note'
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
    | 'admin.settings.email.forced_off'
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
    | 'admin.settings.email.rate_defaults_note'
    | 'admin.settings.email.rate_hint'
    | 'admin.settings.email.rate_limits'
    | 'admin.settings.email.rate_limits_for'
    | 'admin.settings.email.reply_to'
    | 'admin.settings.email.reply_to_hint'
    | 'admin.settings.email.require_verification'
    | 'admin.settings.email.select_provider'
    | 'admin.settings.email.select_provider_hint'
    | 'admin.settings.email.send_test'
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
    | 'admin.settings.email.test_passed'
    | 'admin.settings.email.testing'
    | 'admin.settings.email.title'
    | 'admin.settings.email.turned_off_note'
    | 'admin.settings.email.verification_note'
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
    | 'admin.settings.integrations.access_key'
    | 'admin.settings.integrations.access_key_placeholder'
    | 'admin.settings.integrations.geo'
    | 'admin.settings.integrations.geo_custom_option'
    | 'admin.settings.integrations.geo_disabled_hint'
    | 'admin.settings.integrations.geo_enable'
    | 'admin.settings.integrations.geo_endpoint'
    | 'admin.settings.integrations.geo_endpoint_hint'
    | 'admin.settings.integrations.geo_endpoint_placeholder'
    | 'admin.settings.integrations.geo_guide'
    | 'admin.settings.integrations.geo_intro'
    | 'admin.settings.integrations.geo_ipapi_hint'
    | 'admin.settings.integrations.geo_ipapi_option'
    | 'admin.settings.integrations.geo_ipinfo_option'
    | 'admin.settings.integrations.geo_key'
    | 'admin.settings.integrations.geo_key_placeholder'
    | 'admin.settings.integrations.geo_note'
    | 'admin.settings.integrations.geo_provider'
    | 'admin.settings.integrations.geo_s1_a'
    | 'admin.settings.integrations.geo_s1_b'
    | 'admin.settings.integrations.geo_s1_c'
    | 'admin.settings.integrations.geo_s1_title'
    | 'admin.settings.integrations.geo_s2_a'
    | 'admin.settings.integrations.geo_s2_b'
    | 'admin.settings.integrations.geo_s2_c'
    | 'admin.settings.integrations.geo_s2_title'
    | 'admin.settings.integrations.geo_s3_a'
    | 'admin.settings.integrations.geo_s3_b'
    | 'admin.settings.integrations.geo_s3_c'
    | 'admin.settings.integrations.geo_s3_title'
    | 'admin.settings.integrations.geo_save_failed'
    | 'admin.settings.integrations.geo_saved'
    | 'admin.settings.integrations.geo_subtitle'
    | 'admin.settings.integrations.geo_token'
    | 'admin.settings.integrations.geo_token_hint'
    | 'admin.settings.integrations.geo_token_placeholder'
    | 'admin.settings.integrations.save_geo'
    | 'admin.settings.integrations.save_unsplash'
    | 'admin.settings.integrations.secret_key'
    | 'admin.settings.integrations.secret_key_placeholder'
    | 'admin.settings.integrations.subtitle'
    | 'admin.settings.integrations.unsplash'
    | 'admin.settings.integrations.unsplash_guide'
    | 'admin.settings.integrations.unsplash_hint'
    | 'admin.settings.integrations.unsplash_intro'
    | 'admin.settings.integrations.unsplash_note'
    | 'admin.settings.integrations.unsplash_s1_a'
    | 'admin.settings.integrations.unsplash_s1_b'
    | 'admin.settings.integrations.unsplash_s1_c'
    | 'admin.settings.integrations.unsplash_s1_title'
    | 'admin.settings.integrations.unsplash_s2_a'
    | 'admin.settings.integrations.unsplash_s2_b'
    | 'admin.settings.integrations.unsplash_s2_c'
    | 'admin.settings.integrations.unsplash_s2_d'
    | 'admin.settings.integrations.unsplash_s2_title'
    | 'admin.settings.integrations.unsplash_s3_a'
    | 'admin.settings.integrations.unsplash_s3_b'
    | 'admin.settings.integrations.unsplash_s3_c'
    | 'admin.settings.integrations.unsplash_s3_title'
    | 'admin.settings.integrations.unsplash_save_failed'
    | 'admin.settings.integrations.unsplash_saved'
    | 'admin.settings.integrations.unsplash_subtitle'
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
    | 'admin.settings.localization.rtl_badge'
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
    | 'admin.settings.misc.media_intro'
    | 'admin.settings.misc.media_saved'
    | 'admin.settings.misc.media_upload'
    | 'admin.settings.misc.powered_by'
    | 'admin.settings.misc.powered_by_note'
    | 'admin.settings.misc.save_branding'
    | 'admin.settings.misc.save_media'
    | 'admin.settings.misc.webp_note'
    | 'admin.settings.payments.body'
    | 'admin.settings.payments.cancel_url'
    | 'admin.settings.payments.connect_failed'
    | 'admin.settings.payments.connected'
    | 'admin.settings.payments.dodo'
    | 'admin.settings.payments.emails'
    | 'admin.settings.payments.emails_note'
    | 'admin.settings.payments.enable'
    | 'admin.settings.payments.keys_note'
    | 'admin.settings.payments.live'
    | 'admin.settings.payments.live_key'
    | 'admin.settings.payments.mode'
    | 'admin.settings.payments.not_yet'
    | 'admin.settings.payments.received_question'
    | 'admin.settings.payments.received_yes'
    | 'admin.settings.payments.save_failed'
    | 'admin.settings.payments.save_template'
    | 'admin.settings.payments.saved'
    | 'admin.settings.payments.send_this'
    | 'admin.settings.payments.subject'
    | 'admin.settings.payments.subtitle'
    | 'admin.settings.payments.success_url'
    | 'admin.settings.payments.test'
    | 'admin.settings.payments.test_confirmed'
    | 'admin.settings.payments.test_connection'
    | 'admin.settings.payments.test_email'
    | 'admin.settings.payments.test_key'
    | 'admin.settings.payments.test_prompt'
    | 'admin.settings.payments.testing'
    | 'admin.settings.payments.unknown_error'
    | 'admin.settings.payments.webhook_note'
    | 'admin.settings.payments.webhook_note_end'
    | 'admin.settings.payments.webhook_secret'
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
    | 'admin.settings.test_connection.check_folders'
    | 'admin.settings.test_connection.email_invalid'
    | 'admin.settings.test_connection.email_required'
    | 'admin.settings.test_connection.intro'
    | 'admin.settings.test_connection.message'
    | 'admin.settings.test_connection.send'
    | 'admin.settings.test_connection.subject'
    | 'admin.settings.test_connection.title'
    | 'admin.settings.test_connection.to'
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
    | 'admin.transactions.col_amount'
    | 'admin.transactions.col_customer'
    | 'admin.transactions.col_date'
    | 'admin.transactions.col_event'
    | 'admin.transactions.col_plan'
    | 'admin.transactions.failed'
    | 'admin.transactions.none'
    | 'admin.transactions.pending'
    | 'admin.transactions.refunded'
    | 'admin.transactions.subtitle'
    | 'admin.transactions.succeeded'
    | 'admin.transactions.title'
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
    | 'common.actions.clear'
    | 'common.actions.close'
    | 'common.actions.confirm'
    | 'common.actions.copy'
    | 'common.actions.delete'
    | 'common.actions.delete_confirm'
    | 'common.actions.edit'
    | 'common.actions.enable'
    | 'common.actions.hide'
    | 'common.actions.logout'
    | 'common.actions.open'
    | 'common.actions.remove'
    | 'common.actions.reset'
    | 'common.actions.save'
    | 'common.actions.save_settings'
    | 'common.actions.save_short'
    | 'common.actions.saving'
    | 'common.actions.search'
    | 'common.actions.show'
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
    | 'common.not_available'
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
    | 'common.unknown_error'
    | 'common.validation.generic'
    | 'common.validation.maxlength'
    | 'common.validation.minlength'
    | 'common.validation.required'
    | 'common.yes'
    | 'user.account.balance'
    | 'user.account.change'
    | 'user.account.customer_id'
    | 'user.account.discount_code'
    | 'user.account.no_transactions'
    | 'user.account.plan_deal'
    | 'user.account.pro_chip'
    | 'user.account.reason'
    | 'user.account.sign_in'
    | 'user.account.sign_in_prompt'
    | 'user.account.subscription_id'
    | 'user.account.tier_rank'
    | 'user.account.title'
    | 'user.account.transaction_history'
    | 'user.account.view_plans'
    | 'user.credits'
    | 'user.dashboard.account_hint'
    | 'user.dashboard.buy_credits'
    | 'user.dashboard.credits'
    | 'user.dashboard.deal'
    | 'user.dashboard.discount'
    | 'user.dashboard.free_note'
    | 'user.dashboard.get_started'
    | 'user.dashboard.history'
    | 'user.dashboard.manage_billing'
    | 'user.dashboard.membership'
    | 'user.dashboard.no_activity'
    | 'user.dashboard.open_premium'
    | 'user.dashboard.plan_tier'
    | 'user.dashboard.plans_hint'
    | 'user.dashboard.plans_pricing'
    | 'user.dashboard.premium_note'
    | 'user.dashboard.premium_unlocked'
    | 'user.dashboard.profile_hint'
    | 'user.dashboard.quick_links'
    | 'user.dashboard.recent_activity'
    | 'user.dashboard.renews'
    | 'user.dashboard.see_plans'
    | 'user.dashboard.subtitle'
    | 'user.dashboard.updates_until'
    | 'user.dashboard.upgrade'
    | 'user.dashboard.view_all'
    | 'user.dashboard.welcome'
    | 'user.free'
    | 'user.nav.account'
    | 'user.nav.dashboard'
    | 'user.nav.plans'
    | 'user.nav.premium'
    | 'user.nav.profile'
    | 'user.nav.sign_out'
    | 'user.premium.advanced_analytics'
    | 'user.premium.back'
    | 'user.premium.on_plan'
    | 'user.premium.placeholder'
    | 'user.premium.priority_processing'
    | 'user.premium.priority_support'
    | 'user.premium.title'
    | 'user.profile.subtitle'
    | 'user.profile.title';

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
    'admin.contents.editor.click_to_select_icon',
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
    'admin.contents.editor.repeater.add',
    'admin.contents.editor.repeater.choose_media',
    'admin.contents.editor.repeater.empty',
    'admin.contents.editor.repeater.image',
    'admin.contents.editor.repeater.position',
    'admin.contents.editor.restore_version',
    'admin.contents.editor.save_draft',
    'admin.contents.editor.select_icon',
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
    'admin.dashboard.active',
    'admin.dashboard.col_date',
    'admin.dashboard.col_details',
    'admin.dashboard.col_referrals',
    'admin.dashboard.col_waitlist',
    'admin.dashboard.configure_email',
    'admin.dashboard.connect',
    'admin.dashboard.content_media',
    'admin.dashboard.count_draft',
    'admin.dashboard.count_published',
    'admin.dashboard.count_this_week',
    'admin.dashboard.debug_banner',
    'admin.dashboard.debug_provider_active',
    'admin.dashboard.email_disabled_note',
    'admin.dashboard.email_not_configured',
    'admin.dashboard.email_settings',
    'admin.dashboard.firebase_console_note',
    'admin.dashboard.ga_not_connected',
    'admin.dashboard.ga_overview',
    'admin.dashboard.ga_setup_hint',
    'admin.dashboard.growth_leads',
    'admin.dashboard.inactive',
    'admin.dashboard.last_sync',
    'admin.dashboard.media',
    'admin.dashboard.media_files',
    'admin.dashboard.no_analytics_yet',
    'admin.dashboard.no_data',
    'admin.dashboard.no_recent_activity',
    'admin.dashboard.no_recent_signups',
    'admin.dashboard.property_account',
    'admin.dashboard.property_intro',
    'admin.dashboard.property_title',
    'admin.dashboard.recent_activity',
    'admin.dashboard.recent_signups',
    'admin.dashboard.refresh',
    'admin.dashboard.refresh_failed',
    'admin.dashboard.refreshing',
    'admin.dashboard.setup_analytics',
    'admin.dashboard.this_week',
    'admin.dashboard.title',
    'admin.dashboard.total_signups',
    'admin.dashboard.view_all',
    'admin.dashboard.view_full_analytics',
    'admin.data.export.bundle_badge',
    'admin.data.export.collections_selected',
    'admin.data.export.complete',
    'admin.data.export.drafts',
    'admin.data.export.export_selected',
    'admin.data.export.exporting',
    'admin.data.export.failed',
    'admin.data.export.progress',
    'admin.data.export.progress_detail',
    'admin.data.export.published',
    'admin.data.export.subtitle',
    'admin.data.export.tags',
    'admin.data.export.title',
    'admin.data.export_files.download_zip',
    'admin.data.export_files.downloading',
    'admin.data.export_files.failed',
    'admin.data.export_files.loading',
    'admin.data.export_files.none',
    'admin.data.export_files.of_selected',
    'admin.data.export_files.progress',
    'admin.data.export_files.select_all',
    'admin.data.export_files.subtitle',
    'admin.data.export_files.title',
    'admin.data.group_audience',
    'admin.data.group_content',
    'admin.data.group_email',
    'admin.data.group_settings',
    'admin.data.group_users',
    'admin.data.import.back',
    'admin.data.import.browse',
    'admin.data.import.complete',
    'admin.data.import.counts',
    'admin.data.import.drag_drop',
    'admin.data.import.error_details',
    'admin.data.import.errors',
    'admin.data.import.failed',
    'admin.data.import.import_selected',
    'admin.data.import.imported',
    'admin.data.import.importing',
    'admin.data.import.merge',
    'admin.data.import.new_import',
    'admin.data.import.on_conflict',
    'admin.data.import.overwrite',
    'admin.data.import.per_collection',
    'admin.data.import.preview_title',
    'admin.data.import.progress_title',
    'admin.data.import.select_all',
    'admin.data.import.skip',
    'admin.data.import.skipped',
    'admin.data.import.step_import',
    'admin.data.import.step_preview',
    'admin.data.import.step_upload',
    'admin.data.import.summary',
    'admin.data.import.upload_hint',
    'admin.data.import.upload_title',
    'admin.data.import.version_collections',
    'admin.data.import.warnings',
    'admin.data.import_files.complete',
    'admin.data.import_files.drag_drop',
    'admin.data.import_files.entries_found',
    'admin.data.import_files.failed_count',
    'admin.data.import_files.files_selected',
    'admin.data.import_files.invalid_manifest',
    'admin.data.import_files.manifest',
    'admin.data.import_files.manifest_hint',
    'admin.data.import_files.new_upload',
    'admin.data.import_files.path_prefix',
    'admin.data.import_files.restore',
    'admin.data.import_files.restore_failed',
    'admin.data.import_files.subtitle',
    'admin.data.import_files.successful',
    'admin.data.import_files.title',
    'admin.data.import_files.update_metadata',
    'admin.data.import_files.upload',
    'admin.data.import_files.upload_failed',
    'admin.data.import_files.upload_n',
    'admin.data.import_files.upload_new',
    'admin.data.import_files.uploading',
    'admin.data.import_files.uploading_progress',
    'admin.data.other_collections',
    'admin.data.preset_all_content',
    'admin.data.preset_all_settings',
    'admin.data.preset_everything',
    'admin.data.subtitle',
    'admin.data.title',
    'admin.media.api_hint',
    'admin.media.api_not_configured',
    'admin.media.configure_api',
    'admin.media.delete_failed',
    'admin.media.dimensions',
    'admin.media.drop_hint',
    'admin.media.empty',
    'admin.media.icons.insert',
    'admin.media.icons.load_failed',
    'admin.media.icons.loading',
    'admin.media.icons.name_label',
    'admin.media.icons.no_results',
    'admin.media.icons.none_selected',
    'admin.media.icons.search_placeholder',
    'admin.media.icons.selected',
    'admin.media.icons.show_more',
    'admin.media.icons.showing',
    'admin.media.icons.style_all',
    'admin.media.icons.style_brands',
    'admin.media.icons.style_filter',
    'admin.media.icons.style_label',
    'admin.media.icons.style_regular',
    'admin.media.icons.style_solid',
    'admin.media.icons.tab',
    'admin.media.insert',
    'admin.media.load_failed',
    'admin.media.logo_alt',
    'admin.media.metadata_failed',
    'admin.media.open_full',
    'admin.media.search_failed',
    'admin.media.search_placeholder',
    'admin.media.searching',
    'admin.media.select_page',
    'admin.media.selected',
    'admin.media.selected_image_alt',
    'admin.media.supports',
    'admin.media.upload_new',
    'admin.media.uploaded',
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
    'admin.products.active',
    'admin.products.add_tier',
    'admin.products.code',
    'admin.products.code_note',
    'admin.products.confirmed_sales',
    'admin.products.copy_failed',
    'admin.products.copy_link',
    'admin.products.create_failed',
    'admin.products.created',
    'admin.products.created_toast',
    'admin.products.credits',
    'admin.products.credits_hint',
    'admin.products.currency',
    'admin.products.days',
    'admin.products.delete_failed',
    'admin.products.deleted',
    'admin.products.description',
    'admin.products.discount_code',
    'admin.products.display_only',
    'admin.products.dodo_id',
    'admin.products.features',
    'admin.products.generate',
    'admin.products.generating',
    'admin.products.grandfathering',
    'admin.products.grandfathering_note',
    'admin.products.higher_more_access',
    'admin.products.inactive',
    'admin.products.interval',
    'admin.products.label',
    'admin.products.limit',
    'admin.products.link_copied',
    'admin.products.link_failed',
    'admin.products.link_note',
    'admin.products.list_price',
    'admin.products.monthly',
    'admin.products.name',
    'admin.products.new',
    'admin.products.no_checkout_url',
    'admin.products.no_tiers',
    'admin.products.none',
    'admin.products.none_value',
    'admin.products.off',
    'admin.products.off_percent',
    'admin.products.one_time',
    'admin.products.open_new_tab',
    'admin.products.premium_type',
    'admin.products.price',
    'admin.products.pricing_tiers',
    'admin.products.rank_hint',
    'admin.products.save',
    'admin.products.sold',
    'admin.products.subscription',
    'admin.products.subtitle',
    'admin.products.test_link',
    'admin.products.tier',
    'admin.products.tier_note',
    'admin.products.tier_rank',
    'admin.products.title',
    'admin.products.trial',
    'admin.products.trial_days',
    'admin.products.type',
    'admin.products.update_failed',
    'admin.products.updated',
    'admin.products.updates_hint',
    'admin.products.updates_years',
    'admin.products.view_details',
    'admin.products.yearly',
    'admin.settings.about.address',
    'admin.settings.about.address_hint',
    'admin.settings.about.address_placeholder',
    'admin.settings.about.intro',
    'admin.settings.about.production_url',
    'admin.settings.about.production_url_hint',
    'admin.settings.about.production_url_placeholder',
    'admin.settings.about.site_name',
    'admin.settings.about.site_name_hint',
    'admin.settings.about.site_name_placeholder',
    'admin.settings.analytics.client_id',
    'admin.settings.analytics.client_id_placeholder',
    'admin.settings.analytics.client_id_required',
    'admin.settings.analytics.client_secret',
    'admin.settings.analytics.client_secret_placeholder',
    'admin.settings.analytics.client_secret_required',
    'admin.settings.analytics.configure',
    'admin.settings.analytics.configured',
    'admin.settings.analytics.connect_button',
    'admin.settings.analytics.connect_failed',
    'admin.settings.analytics.connect_intro',
    'admin.settings.analytics.connect_success',
    'admin.settings.analytics.connected',
    'admin.settings.analytics.connected_to',
    'admin.settings.analytics.connecting',
    'admin.settings.analytics.connection',
    'admin.settings.analytics.copied',
    'admin.settings.analytics.copy_failed',
    'admin.settings.analytics.creds_hint',
    'admin.settings.analytics.creds_save_failed',
    'admin.settings.analytics.creds_saved',
    'admin.settings.analytics.disconnect',
    'admin.settings.analytics.disconnect_failed',
    'admin.settings.analytics.disconnected',
    'admin.settings.analytics.disconnecting',
    'admin.settings.analytics.guide',
    'admin.settings.analytics.intro',
    'admin.settings.analytics.live_site',
    'admin.settings.analytics.local_dev',
    'admin.settings.analytics.not_connected',
    'admin.settings.analytics.oauth_credentials',
    'admin.settings.analytics.property',
    'admin.settings.analytics.required_by_google',
    'admin.settings.analytics.s1_a',
    'admin.settings.analytics.s1_b',
    'admin.settings.analytics.s1_c',
    'admin.settings.analytics.s1_d',
    'admin.settings.analytics.s1_e',
    'admin.settings.analytics.s1_title',
    'admin.settings.analytics.s2_a',
    'admin.settings.analytics.s2_b',
    'admin.settings.analytics.s2_c',
    'admin.settings.analytics.s2_c1',
    'admin.settings.analytics.s2_c2',
    'admin.settings.analytics.s2_c3',
    'admin.settings.analytics.s2_c4',
    'admin.settings.analytics.s2_d',
    'admin.settings.analytics.s2_e',
    'admin.settings.analytics.s2_f',
    'admin.settings.analytics.s2_g',
    'admin.settings.analytics.s2_h',
    'admin.settings.analytics.s2_i',
    'admin.settings.analytics.s2_j',
    'admin.settings.analytics.s2_title',
    'admin.settings.analytics.s3_a',
    'admin.settings.analytics.s3_b',
    'admin.settings.analytics.s3_c',
    'admin.settings.analytics.s3_d',
    'admin.settings.analytics.s3_title',
    'admin.settings.analytics.same_account',
    'admin.settings.analytics.save_credentials',
    'admin.settings.analytics.save_creds_first',
    'admin.settings.analytics.save_first',
    'admin.settings.analytics.saved_hint',
    'admin.settings.analytics.select_property_failed',
    'admin.settings.analytics.subtitle',
    'admin.settings.analytics.title',
    'admin.settings.analytics.why_note',
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
    'admin.settings.email.forced_off',
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
    'admin.settings.email.rate_defaults_note',
    'admin.settings.email.rate_hint',
    'admin.settings.email.rate_limits',
    'admin.settings.email.rate_limits_for',
    'admin.settings.email.reply_to',
    'admin.settings.email.reply_to_hint',
    'admin.settings.email.require_verification',
    'admin.settings.email.select_provider',
    'admin.settings.email.select_provider_hint',
    'admin.settings.email.send_test',
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
    'admin.settings.email.test_passed',
    'admin.settings.email.testing',
    'admin.settings.email.title',
    'admin.settings.email.turned_off_note',
    'admin.settings.email.verification_note',
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
    'admin.settings.integrations.access_key',
    'admin.settings.integrations.access_key_placeholder',
    'admin.settings.integrations.geo',
    'admin.settings.integrations.geo_custom_option',
    'admin.settings.integrations.geo_disabled_hint',
    'admin.settings.integrations.geo_enable',
    'admin.settings.integrations.geo_endpoint',
    'admin.settings.integrations.geo_endpoint_hint',
    'admin.settings.integrations.geo_endpoint_placeholder',
    'admin.settings.integrations.geo_guide',
    'admin.settings.integrations.geo_intro',
    'admin.settings.integrations.geo_ipapi_hint',
    'admin.settings.integrations.geo_ipapi_option',
    'admin.settings.integrations.geo_ipinfo_option',
    'admin.settings.integrations.geo_key',
    'admin.settings.integrations.geo_key_placeholder',
    'admin.settings.integrations.geo_note',
    'admin.settings.integrations.geo_provider',
    'admin.settings.integrations.geo_s1_a',
    'admin.settings.integrations.geo_s1_b',
    'admin.settings.integrations.geo_s1_c',
    'admin.settings.integrations.geo_s1_title',
    'admin.settings.integrations.geo_s2_a',
    'admin.settings.integrations.geo_s2_b',
    'admin.settings.integrations.geo_s2_c',
    'admin.settings.integrations.geo_s2_title',
    'admin.settings.integrations.geo_s3_a',
    'admin.settings.integrations.geo_s3_b',
    'admin.settings.integrations.geo_s3_c',
    'admin.settings.integrations.geo_s3_title',
    'admin.settings.integrations.geo_save_failed',
    'admin.settings.integrations.geo_saved',
    'admin.settings.integrations.geo_subtitle',
    'admin.settings.integrations.geo_token',
    'admin.settings.integrations.geo_token_hint',
    'admin.settings.integrations.geo_token_placeholder',
    'admin.settings.integrations.save_geo',
    'admin.settings.integrations.save_unsplash',
    'admin.settings.integrations.secret_key',
    'admin.settings.integrations.secret_key_placeholder',
    'admin.settings.integrations.subtitle',
    'admin.settings.integrations.unsplash',
    'admin.settings.integrations.unsplash_guide',
    'admin.settings.integrations.unsplash_hint',
    'admin.settings.integrations.unsplash_intro',
    'admin.settings.integrations.unsplash_note',
    'admin.settings.integrations.unsplash_s1_a',
    'admin.settings.integrations.unsplash_s1_b',
    'admin.settings.integrations.unsplash_s1_c',
    'admin.settings.integrations.unsplash_s1_title',
    'admin.settings.integrations.unsplash_s2_a',
    'admin.settings.integrations.unsplash_s2_b',
    'admin.settings.integrations.unsplash_s2_c',
    'admin.settings.integrations.unsplash_s2_d',
    'admin.settings.integrations.unsplash_s2_title',
    'admin.settings.integrations.unsplash_s3_a',
    'admin.settings.integrations.unsplash_s3_b',
    'admin.settings.integrations.unsplash_s3_c',
    'admin.settings.integrations.unsplash_s3_title',
    'admin.settings.integrations.unsplash_save_failed',
    'admin.settings.integrations.unsplash_saved',
    'admin.settings.integrations.unsplash_subtitle',
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
    'admin.settings.localization.rtl_badge',
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
    'admin.settings.misc.media_intro',
    'admin.settings.misc.media_saved',
    'admin.settings.misc.media_upload',
    'admin.settings.misc.powered_by',
    'admin.settings.misc.powered_by_note',
    'admin.settings.misc.save_branding',
    'admin.settings.misc.save_media',
    'admin.settings.misc.webp_note',
    'admin.settings.payments.body',
    'admin.settings.payments.cancel_url',
    'admin.settings.payments.connect_failed',
    'admin.settings.payments.connected',
    'admin.settings.payments.dodo',
    'admin.settings.payments.emails',
    'admin.settings.payments.emails_note',
    'admin.settings.payments.enable',
    'admin.settings.payments.keys_note',
    'admin.settings.payments.live',
    'admin.settings.payments.live_key',
    'admin.settings.payments.mode',
    'admin.settings.payments.not_yet',
    'admin.settings.payments.received_question',
    'admin.settings.payments.received_yes',
    'admin.settings.payments.save_failed',
    'admin.settings.payments.save_template',
    'admin.settings.payments.saved',
    'admin.settings.payments.send_this',
    'admin.settings.payments.subject',
    'admin.settings.payments.subtitle',
    'admin.settings.payments.success_url',
    'admin.settings.payments.test',
    'admin.settings.payments.test_confirmed',
    'admin.settings.payments.test_connection',
    'admin.settings.payments.test_email',
    'admin.settings.payments.test_key',
    'admin.settings.payments.test_prompt',
    'admin.settings.payments.testing',
    'admin.settings.payments.unknown_error',
    'admin.settings.payments.webhook_note',
    'admin.settings.payments.webhook_note_end',
    'admin.settings.payments.webhook_secret',
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
    'admin.settings.test_connection.check_folders',
    'admin.settings.test_connection.email_invalid',
    'admin.settings.test_connection.email_required',
    'admin.settings.test_connection.intro',
    'admin.settings.test_connection.message',
    'admin.settings.test_connection.send',
    'admin.settings.test_connection.subject',
    'admin.settings.test_connection.title',
    'admin.settings.test_connection.to',
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
    'admin.transactions.col_amount',
    'admin.transactions.col_customer',
    'admin.transactions.col_date',
    'admin.transactions.col_event',
    'admin.transactions.col_plan',
    'admin.transactions.failed',
    'admin.transactions.none',
    'admin.transactions.pending',
    'admin.transactions.refunded',
    'admin.transactions.subtitle',
    'admin.transactions.succeeded',
    'admin.transactions.title',
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
    'common.actions.clear',
    'common.actions.close',
    'common.actions.confirm',
    'common.actions.copy',
    'common.actions.delete',
    'common.actions.delete_confirm',
    'common.actions.edit',
    'common.actions.enable',
    'common.actions.hide',
    'common.actions.logout',
    'common.actions.open',
    'common.actions.remove',
    'common.actions.reset',
    'common.actions.save',
    'common.actions.save_settings',
    'common.actions.save_short',
    'common.actions.saving',
    'common.actions.search',
    'common.actions.show',
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
    'common.not_available',
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
    'common.unknown_error',
    'common.validation.generic',
    'common.validation.maxlength',
    'common.validation.minlength',
    'common.validation.required',
    'common.yes',
    'user.account.balance',
    'user.account.change',
    'user.account.customer_id',
    'user.account.discount_code',
    'user.account.no_transactions',
    'user.account.plan_deal',
    'user.account.pro_chip',
    'user.account.reason',
    'user.account.sign_in',
    'user.account.sign_in_prompt',
    'user.account.subscription_id',
    'user.account.tier_rank',
    'user.account.title',
    'user.account.transaction_history',
    'user.account.view_plans',
    'user.credits',
    'user.dashboard.account_hint',
    'user.dashboard.buy_credits',
    'user.dashboard.credits',
    'user.dashboard.deal',
    'user.dashboard.discount',
    'user.dashboard.free_note',
    'user.dashboard.get_started',
    'user.dashboard.history',
    'user.dashboard.manage_billing',
    'user.dashboard.membership',
    'user.dashboard.no_activity',
    'user.dashboard.open_premium',
    'user.dashboard.plan_tier',
    'user.dashboard.plans_hint',
    'user.dashboard.plans_pricing',
    'user.dashboard.premium_note',
    'user.dashboard.premium_unlocked',
    'user.dashboard.profile_hint',
    'user.dashboard.quick_links',
    'user.dashboard.recent_activity',
    'user.dashboard.renews',
    'user.dashboard.see_plans',
    'user.dashboard.subtitle',
    'user.dashboard.updates_until',
    'user.dashboard.upgrade',
    'user.dashboard.view_all',
    'user.dashboard.welcome',
    'user.free',
    'user.nav.account',
    'user.nav.dashboard',
    'user.nav.plans',
    'user.nav.premium',
    'user.nav.profile',
    'user.nav.sign_out',
    'user.premium.advanced_analytics',
    'user.premium.back',
    'user.premium.on_plan',
    'user.premium.placeholder',
    'user.premium.priority_processing',
    'user.premium.priority_support',
    'user.premium.title',
    'user.profile.subtitle',
    'user.profile.title',
];
