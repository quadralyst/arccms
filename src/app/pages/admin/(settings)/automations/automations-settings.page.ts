/**
 * Settings, Automations (specs/coexistence-spec.md section 5b, CO6.5d).
 *
 * An editor for `Settings/event_mappings`: for each event (built-in ones, and
 * the app-user ones when an app is connected, one per watched field), an on/off
 * switch and rules. A rule has a name, for field changes an optional condition
 * on the old and new value, and actions: send an email, and for events about
 * ArcCMS users and contacts, create a notification or change list membership.
 * App-user events never touch lists: that would copy people into Contacts, and
 * App users (live) lists cover it.
 */
import { ChangeDetectionStrategy, Component, DestroyRef, Injector, OnInit, computed, inject, runInInjectionContext, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Firestore, collection, doc, getDoc, getDocs, setDoc } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { arcCallable } from '../../../../core/config/arc-functions';
import { ToastService } from '../../../../../shared/services/toast.service';
import { AudienceService } from '../../(audience)/audience.service';
import { IList, contactLists } from '../../(audience)/audience.model';
import { isOn } from '../../../../core/features/features';
import {
    ConditionKind,
    EventDraft,
    EventInfo,
    availableEvents,
    draftProblems,
    draftToMapping,
    emptyRule,
    mappingToDraft,
} from './automation-model';

interface TemplateOption {
    type: string;
    label: string;
}

/** Known events with their own label; field changes and unknown events are labelled by pattern. */
const EVENT_LABEL_KEYS: Record<string, string> = {
    'user.signed_up': 'user_signed_up',
    'payment.succeeded': 'payment_succeeded',
    'payment.failed': 'payment_failed',
    'waitlist.joined': 'waitlist_joined',
    'app_user.created': 'app_user_created',
    'app_user.deleted': 'app_user_deleted',
};

/**
 * Templates another feature sends with its own data: a sign-up or form code,
 * the in-app notification's title and body, the admin digest. A rule has none
 * of that, so its email would go out with a blank subject and body (or a code
 * nobody asked for). They are not offered in rules.
 */
export const NOT_FOR_RULES: readonly string[] = [
    'signup_otp_email', 'waitlist_verify_otp_email', 'notification_generic_email', 'admin_digest_email',
];

export function isRuleEmailTemplate(type: string): boolean {
    return !!type && !NOT_FOR_RULES.includes(type);
}

@Component({
    selector: 'arc-automations-settings',
    standalone: true,
    imports: [FormsModule, TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    <div class="settings-section">
      <h3 class="mb-2">{{ 'admin.settings.automations.title' | transloco }}</h3>
      <p class="text-muted mb-4">{{ 'admin.settings.automations.intro' | transloco }}</p>

      @if (loading()) {
        <p class="text-muted"><i class="fas fa-spinner fa-spin me-1"></i> {{ 'common.state.loading' | transloco }}</p>
      } @else if (error()) {
        <div class="alert alert-danger">{{ 'admin.settings.automations.load_failed' | transloco: { error: error() } }}</div>
      } @else {
        @for (ev of events(); track ev.type) {
          @let d = drafts()[ev.type];
          <details class="automation-event mb-2" [open]="openType() === ev.type" (toggle)="onToggle(ev.type, $event)">
            <summary class="d-flex align-items-center gap-2">
              <span class="fw-semibold">{{ eventLabel(ev) | transloco: { field: ev.field } }}</span>
              <code class="small text-muted">{{ ev.type }}</code>
              <span class="ms-auto status-badge" [class.is-success]="d.enabled" [class.is-neutral]="!d.enabled">
                {{ (d.enabled ? 'admin.settings.automations.on' : 'admin.settings.automations.off') | transloco }}
              </span>
              <span class="small text-muted">{{ 'admin.settings.automations.rule_count' | transloco: { count: d.rules.length } }}</span>
            </summary>

            <div class="event-body">
              <div class="form-check form-switch mb-3">
                <input class="form-check-input" type="checkbox" role="switch" [id]="'on-' + ev.type"
                       [ngModel]="d.enabled" (ngModelChange)="patchEvent(ev.type, { enabled: $event })">
                <label class="form-check-label" [for]="'on-' + ev.type">{{ 'admin.settings.automations.event_on' | transloco }}</label>
              </div>
              @if (ev.appUser) {
                <p class="small text-muted">{{ 'admin.settings.automations.app_user_hint' | transloco }}</p>
              }

              @for (r of d.rules; track $index; let i = $index) {
                <div class="rule-card mb-3">
                  <div class="d-flex gap-2 align-items-center mb-2">
                    <input class="form-control form-control-sm rule-name" [attr.aria-label]="'admin.settings.automations.rule_name' | transloco"
                           [placeholder]="'admin.settings.automations.rule_name' | transloco"
                           [ngModel]="r.name" (ngModelChange)="patchRule(ev.type, i, { name: $event })">
                    <div class="form-check form-switch mb-0">
                      <input class="form-check-input" type="checkbox" role="switch" [id]="'rule-on-' + ev.type + i"
                             [ngModel]="r.enabled" (ngModelChange)="patchRule(ev.type, i, { enabled: $event })">
                      <label class="form-check-label small" [for]="'rule-on-' + ev.type + i">{{ 'admin.settings.automations.rule_on' | transloco }}</label>
                    </div>
                    <button type="button" class="btn btn-sm btn-link text-danger ms-auto" (click)="removeRule(ev.type, i)">
                      {{ 'admin.settings.automations.remove_rule' | transloco }}
                    </button>
                  </div>

                  @if (ev.field) {
                    <div class="row g-2 mb-2 small">
                      @for (side of sides; track side.id) {
                        <div class="col-md-6">
                          <label class="form-label mb-1">{{ side.labelKey | transloco: { field: ev.field } }}</label>
                          <div class="d-flex gap-2">
                            <select class="form-select form-select-sm w-auto"
                                    [ngModel]="side.id === 'from' ? r.fromKind : r.toKind"
                                    (ngModelChange)="patchRule(ev.type, i, side.id === 'from' ? { fromKind: $event } : { toKind: $event })">
                              @for (k of conditionKinds; track k) {
                                <option [value]="k">{{ 'admin.settings.automations.condition.' + k | transloco }}</option>
                              }
                            </select>
                            @if ((side.id === 'from' ? r.fromKind : r.toKind) !== 'any') {
                              <input class="form-control form-control-sm"
                                     [placeholder]="'admin.settings.automations.value_placeholder' | transloco"
                                     [ngModel]="side.id === 'from' ? r.fromText : r.toText"
                                     (ngModelChange)="patchRule(ev.type, i, side.id === 'from' ? { fromText: $event } : { toText: $event })">
                            }
                          </div>
                        </div>
                      }
                    </div>
                  }

                  <div class="form-check">
                    <input class="form-check-input" type="checkbox" [id]="'mail-' + ev.type + i"
                           [ngModel]="r.sendEmail" (ngModelChange)="patchRule(ev.type, i, { sendEmail: $event })">
                    <label class="form-check-label" [for]="'mail-' + ev.type + i">{{ 'admin.settings.automations.send_email' | transloco }}</label>
                  </div>
                  @if (r.sendEmail) {
                    <div class="d-flex gap-2 flex-wrap ms-4 mb-2">
                      <select class="form-select form-select-sm w-auto" [attr.aria-label]="'admin.settings.automations.template' | transloco"
                              [ngModel]="r.templateType" (ngModelChange)="patchRule(ev.type, i, { templateType: $event })">
                        <option value="">{{ 'admin.settings.automations.choose_template' | transloco }}</option>
                        @for (t of templates(); track t.type) { <option [value]="t.type">{{ t.label }}</option> }
                      </select>
                      <select class="form-select form-select-sm w-auto" [attr.aria-label]="'admin.settings.automations.category' | transloco"
                              [ngModel]="r.category" (ngModelChange)="patchRule(ev.type, i, { category: $event })">
                        <option value="transactional">{{ 'admin.settings.automations.transactional' | transloco }}</option>
                        <option value="marketing">{{ 'admin.settings.automations.marketing' | transloco }}</option>
                      </select>
                    </div>
                  }

                  @if (!ev.appUser) {
                    <div class="form-check">
                      <input class="form-check-input" type="checkbox" [id]="'note-' + ev.type + i"
                             [ngModel]="r.notify" (ngModelChange)="patchRule(ev.type, i, { notify: $event })">
                      <label class="form-check-label" [for]="'note-' + ev.type + i">{{ 'admin.settings.automations.create_notification' | transloco }}</label>
                    </div>
                    @if (r.notify) {
                      <div class="row g-2 ms-3 mb-2">
                        <div class="col-md-4">
                          <select class="form-select form-select-sm" [attr.aria-label]="'admin.settings.automations.notification_type' | transloco"
                                  [ngModel]="r.notificationType" (ngModelChange)="patchRule(ev.type, i, { notificationType: $event })">
                            <option value="">{{ 'admin.settings.automations.notification_type' | transloco }}</option>
                            @for (t of notificationTypes(); track t) { <option [value]="t">{{ t }}</option> }
                          </select>
                        </div>
                        <div class="col-md-8">
                          <input class="form-control form-control-sm" [placeholder]="'admin.settings.automations.notification_title' | transloco"
                                 [ngModel]="r.notificationTitle" (ngModelChange)="patchRule(ev.type, i, { notificationTitle: $event })">
                        </div>
                        <div class="col-md-8">
                          <input class="form-control form-control-sm" [placeholder]="'admin.settings.automations.notification_body' | transloco"
                                 [ngModel]="r.notificationBody" (ngModelChange)="patchRule(ev.type, i, { notificationBody: $event })">
                        </div>
                        <div class="col-md-4">
                          <input class="form-control form-control-sm" [placeholder]="'admin.settings.automations.notification_link' | transloco"
                                 [ngModel]="r.notificationLink" (ngModelChange)="patchRule(ev.type, i, { notificationLink: $event })">
                        </div>
                      </div>
                    }

                    @if (audienceOn) {
                    <div class="row g-2 mt-1 small">
                      @for (side of listSides; track side.id) {
                        <div class="col-md-6">
                          <label class="form-label mb-1">{{ side.labelKey | transloco }}</label>
                          <select class="form-select form-select-sm" multiple size="3"
                                  [ngModel]="side.id === 'add' ? r.addToLists : r.removeFromLists"
                                  (ngModelChange)="patchRule(ev.type, i, side.id === 'add' ? { addToLists: $event } : { removeFromLists: $event })">
                            @for (l of contactLists(); track l.id) { <option [value]="l.id">{{ l.name }}</option> }
                          </select>
                        </div>
                      }
                    </div>
                    }
                  }
                </div>
              } @empty {
                <p class="small text-muted">{{ 'admin.settings.automations.no_rules' | transloco }}</p>
              }

              @if (problems()[ev.type]?.length) {
                <div class="alert alert-warning small py-2">
                  @for (p of problems()[ev.type]; track p) { <div>{{ 'admin.settings.automations.problem.' + p | transloco }}</div> }
                </div>
              }
              <div class="d-flex gap-2">
                <button type="button" class="btn btn-sm btn-outline-secondary" (click)="addRule(ev.type)">
                  {{ 'admin.settings.automations.add_rule' | transloco }}
                </button>
                <button type="button" class="btn btn-sm btn-primary ms-auto" [disabled]="saving() || !dirty().has(ev.type) || !!problems()[ev.type]?.length"
                        (click)="save(ev.type)">
                  {{ 'admin.settings.automations.save' | transloco }}
                </button>
              </div>
            </div>
          </details>
        }
      }
    </div>
    `,
    styles: [`
        .automation-event { border: 1px solid var(--bs-border-color, #dee2e6); border-radius: 8px; background: var(--bs-body-bg, #fff); }
        .automation-event > summary { cursor: pointer; padding: 12px 16px; list-style: none; flex-wrap: wrap; }
        .automation-event > summary::-webkit-details-marker { display: none; }
        .event-body { padding: 0 16px 16px; }
        .rule-card { border: 1px solid var(--bs-border-color, #dee2e6); border-radius: 6px; padding: 12px; }
        .rule-name { max-width: 280px; }
    `],
})
export class AutomationsSettingsPage implements OnInit {
    private firestore = inject(Firestore);
    private functions = inject(Functions);
    private injector = inject(Injector);
    private audience = inject(AudienceService);
    private toast = inject(ToastService);
    private transloco = inject(TranslocoService);
    private destroyRef = inject(DestroyRef);

    readonly conditionKinds: ConditionKind[] = ['any', 'equals', 'any_of', 'none_of'];
    readonly sides = [
        { id: 'from' as const, labelKey: 'admin.settings.automations.when_from' },
        { id: 'to' as const, labelKey: 'admin.settings.automations.when_to' },
    ];
    /** List actions and app-user events need the audience feature. */
    readonly audienceOn = isOn('audience');
    readonly listSides = [
        { id: 'add' as const, labelKey: 'admin.settings.automations.add_to_lists' },
        { id: 'remove' as const, labelKey: 'admin.settings.automations.remove_from_lists' },
    ];

    loading = signal(true);
    error = signal('');
    saving = signal(false);
    events = signal<EventInfo[]>([]);
    drafts = signal<Record<string, EventDraft>>({});
    dirty = signal<Set<string>>(new Set());
    openType = signal('');
    templates = signal<TemplateOption[]>([]);
    notificationTypes = signal<string[]>([]);
    lists = signal<IList[]>([]);
    /** Membership actions only make sense for lists people are added to. */
    contactLists = computed(() => contactLists(this.lists()));
    problems = computed(() => Object.fromEntries(
        Object.entries(this.drafts()).map(([type, d]) => [type, draftProblems(d)]),
    ) as Record<string, string[]>);

    /** The mappings as last loaded or saved. */
    private rawDoc: Record<string, unknown> = {};
    private rawMappings: Record<string, unknown> = {};

    ngOnInit(): void {
        if (this.audienceOn) this.audience.getLists().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((l) => this.lists.set(l));
        void this.load();
    }

    async load(): Promise<void> {
        this.loading.set(true);
        this.error.set('');
        try {
            const read = <T>(fn: () => Promise<T>) => runInInjectionContext(this.injector, fn);
            const [mappingSnap, templateSnap, typesSnap, status] = await Promise.all([
                read(() => getDoc(doc(this.firestore, 'Settings', 'event_mappings'))),
                read(() => getDocs(collection(this.firestore, 'EmailTemplate'))),
                read(() => getDoc(doc(this.firestore, 'Settings', 'notification_types'))),
                // An audience function: without the feature it is not deployed.
                (this.audienceOn
                    ? arcCallable<unknown, { location: { configured: boolean }; settings: { watchedFields?: string[] } }>(this.functions, 'appAudienceStatus')({})
                        .then((r) => r.data)
                    : Promise.reject())
                    .catch(() => ({ location: { configured: false }, settings: { watchedFields: [] as string[] } })),
            ]);

            this.rawDoc = (mappingSnap.data() as Record<string, unknown>) ?? {};
            this.rawMappings = (this.rawDoc['mappings'] as Record<string, unknown>) ?? {};

            // One option per template type: the bus finds a template by its type.
            // Templates another feature fills with its own data are left out.
            const byType = new Map<string, TemplateOption>();
            for (const t of templateSnap.docs) {
                const data = t.data() as Record<string, unknown>;
                const type = String(data['type'] ?? '');
                if (!isRuleEmailTemplate(type) || byType.has(type)) continue;
                byType.set(type, { type, label: String(data['title'] || data['subject'] || type) });
            }
            this.templates.set([...byType.values()].sort((a, b) => a.label.localeCompare(b.label)));
            this.notificationTypes.set(Object.keys((typesSnap.data()?.['types'] as Record<string, unknown>) ?? {}).sort());

            const events = availableEvents({
                appConnected: !!status.location.configured,
                watchedFields: status.settings?.watchedFields ?? [],
                mapped: Object.keys(this.rawMappings),
                on: isOn,
            });
            this.events.set(events);
            this.drafts.set(Object.fromEntries(events.map((e) => [e.type, mappingToDraft(e.type, this.rawMappings[e.type])])));
            this.dirty.set(new Set());
        } catch (e: any) {
            this.error.set(e?.message || String(e));
        } finally {
            this.loading.set(false);
        }
    }

    eventLabel(ev: EventInfo): string {
        if (ev.field) return 'admin.settings.automations.events.app_user_changed';
        const key = EVENT_LABEL_KEYS[ev.type];
        return key ? `admin.settings.automations.events.${key}` : ev.type;
    }

    onToggle(type: string, event: Event): void {
        const open = (event.target as HTMLDetailsElement).open;
        if (open) this.openType.set(type);
        else if (this.openType() === type) this.openType.set('');
    }

    patchEvent(type: string, patch: Partial<EventDraft>): void {
        this.update(type, (d) => ({ ...d, ...patch }));
    }

    patchRule(type: string, index: number, patch: Partial<EventDraft['rules'][number]>): void {
        this.update(type, (d) => ({ ...d, rules: d.rules.map((r, i) => (i === index ? { ...r, ...patch } : r)) }));
    }

    addRule(type: string): void {
        this.update(type, (d) => ({
            ...d,
            rules: [...d.rules, emptyRule(this.transloco.translate('admin.settings.automations.new_rule_name', { n: d.rules.length + 1 }))],
        }));
    }

    removeRule(type: string, index: number): void {
        this.update(type, (d) => ({ ...d, rules: d.rules.filter((_, i) => i !== index) }));
    }

    private update(type: string, fn: (d: EventDraft) => EventDraft): void {
        this.drafts.update((all) => ({ ...all, [type]: fn(all[type]) }));
        this.dirty.update((s) => new Set(s).add(type));
    }

    /**
     * Saves one event. The document is read again first and only this event is
     * replaced, so a change saved meanwhile elsewhere (the Announcements page
     * switches events on and off) is kept.
     */
    async save(type: string): Promise<void> {
        const draft = this.drafts()[type];
        if (!draft || draftProblems(draft).length) return;
        this.saving.set(true);
        try {
            const ref = doc(this.firestore, 'Settings', 'event_mappings');
            const snap = await runInInjectionContext(this.injector, () => getDoc(ref));
            const current = (snap.data() as Record<string, unknown>) ?? {};
            const currentMappings = (current['mappings'] as Record<string, unknown>) ?? {};
            const mappings = { ...currentMappings, [type]: draftToMapping(draft, currentMappings[type]) };
            await setDoc(ref, { ...current, mappings });
            this.rawMappings = mappings;
            this.rawDoc = { ...current, mappings };
            this.dirty.update((s) => { const n = new Set(s); n.delete(type); return n; });
            this.toast.success(this.transloco.translate('admin.settings.automations.saved'));
        } catch (e: any) {
            this.toast.error(this.transloco.translate('admin.settings.automations.save_failed', { error: e?.message || String(e) }));
        } finally {
            this.saving.set(false);
        }
    }
}
