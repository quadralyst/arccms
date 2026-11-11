/**
 * Edit User Component
 *
 * Form component for editing existing users: name and email in the record; the
 * password, the role and the phone number through admin callables, which check
 * what the record alone cannot (adminSetPassword, adminSetUserRole, adminSetPhone).
 */

import { RouteMeta } from '@analogjs/router';
import { SiteBrandService } from '../../../../core/brand/site-brand';
import { ChangeDetectionStrategy, Component, effect, EventEmitter, inject, Input, input, Output, signal, untracked } from '@angular/core';
import { Functions } from '@angular/fire/functions';
import { FormControl, FormGroup, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { TranslocoPipe } from '@jsverse/transloco';
import { BaseComponent } from '../../../../../shared/components/base/base.component';
import { passwordProblemMessage, roleChoices, roleLabel, userActionError, UserFormData } from '../user.model';
import type { TranslationKey } from '../../../../core/i18n/translation-keys';
import { UserService } from '../user.service';
import { UserStore } from '../user.store';
import { AuthState } from '../../../(auth)/auth.store';
import { roleGuard } from '../../../../guards/role.guard';
import { arcCallable } from '../../../../core/config/arc-functions';
import { isLockedAppAccount } from '../../../../core/app-accounts/app-account-lock';
import { newPasswordValidator, passwordProblemOf, sameAsValidator } from '../../../../../shared/utils/password-validator';
import { minPasswordLength } from '../../../../../shared/utils/password-rule';
import { SIGN_IN_STRENGTH } from '../../../../core/sign-in/sign-in-strength';
import { UserSettingService } from '../../(settings)/user-setting/user-setting.service';
import { AVAILABLE_ROLES, emailPinOn } from '../../(settings)/user-setting/user-setting.model';

export const routeMeta: RouteMeta = {
    title: 'Edit user',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

@Component({
    selector: 'arc-edit-user',
    standalone: true,
    imports: [ReactiveFormsModule, MatSlideToggleModule, TranslocoPipe],
    templateUrl: './edit-user.html',
    styleUrl: './edit-user.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export default class EditUserComponent extends BaseComponent {
    /** The site's name for the footer (core/brand/site-brand.ts). */
    readonly siteName = inject(SiteBrandService).name;
    @Output() close = new EventEmitter<void>();
    @Input() role: string | null | undefined;
    action = input('edit');

    userStore = inject(UserStore);
    private userService = inject(UserService);
    private functions = inject(Functions);
    private userSettings = inject(UserSettingService);
    /** The site signs email accounts in with a PIN: a member then has no password to set (specs/sign-in-pin-spec.md). */
    private readonly emailPin = signal(false);
    private lastItem: any = null;
    saving = signal(false);
    errorMessages: string[] = [];
    isPasswordUpdateEnabled: boolean = false;
    /**
     * Whether an admin can set this person's password here: they have an email, and
     * their sign-in is Arc CMS's own (adminSetPassword refuses the rest).
     */
    canSetPassword = signal(false);
    /** Why their password is changed elsewhere (a translation key), or empty. */
    passwordElsewhere = signal<TranslationKey | ''>('');
    alreadyExist: any;

    /**
     * The roles to choose from (Settings, Users lists them), and whether this record's
     * role can be changed here: a locked app account's role is its app's.
     */
    readonly roleOptions = signal<string[]>(roleChoices(AVAILABLE_ROLES));
    readonly canSetRole = signal(true);
    /** The signed-in admin's own record: another admin changes their role (the server refuses it too). */
    readonly ownRecord = signal(false);
    private authState = inject(AuthState);
    readonly roleName = (role: string) => roleLabel(role, (key) => this.t(key));

    /**
     * The member's phone number, which an admin can change for a member who lost
     * their phone (adminSetPhone): shown for a record with a number and a sign-in
     * that is Arc CMS's own.
     */
    readonly currentPhone = signal('');
    readonly canSetPhone = signal(false);
    readonly phoneOpen = signal(false);
    readonly phoneSaving = signal(false);
    readonly phoneError = signal('');
    readonly newPhone = new FormControl('', { nonNullable: true });

    // Edit form
    editForm: FormGroup = new FormGroup({
        name: new FormControl('', [Validators.required]),
        email: new FormControl('', [Validators.required, this.globalService.emailValidator()]),
        password: new FormControl('', []),
        // The new password typed twice, while Update Password is on.
        confirmPassword: new FormControl('', []),
        role: new FormControl('user', { nonNullable: true }),
    });

    // Getter methods for form controls
    get name() {
        return this.editForm.get('name');
    }
    get email() {
        return this.editForm.get('email');
    }
    get password() {
        return this.editForm.get('password');
    }
    get confirmPassword() {
        return this.editForm.get('confirmPassword');
    }
    /** The shortest password the site takes, for the hint in the box. */
    readonly minPassword = minPasswordLength(SIGN_IN_STRENGTH);

    /** Why the new password was refused, in the admin's language. */
    passwordError(): string {
        return passwordProblemMessage(passwordProblemOf(this.password), (key, params) => this.t(key, params), SIGN_IN_STRENGTH);
    }

    // Fill the form when this user's record arrives (an effect: nothing reads a computed here).
    private readonly fillForm = effect(() => {
        const item = this.userStore.currentItem();
        if (item && item.id === this.id) untracked(() => this.updateFormData(item));
    });

    // private variable for id
    #id = '';
    @Input()
    get id(): string {
        return this.#id;
    }
    set id(newValue: string) {
        this.#id = newValue;
        if (this.id) {
            this.userStore.getById(this.id);
        }
    }

    /**
     * Whether this person must have an email. A person who has none (an app account, or a
     * phone sign-up, docs/app/app-accounts.html) can be saved without one; an email
     * typed in is still checked.
     */
    emailRequired = signal(true);

    constructor() {
        super();
        this.userSettings.readSettings().then((settings) => {
            this.emailPin.set(emailPinOn(settings));
            if (this.lastItem) this.updatePasswordNote(this.lastItem);
        }).catch(() => undefined);
    }

    /** Whether, and why not, an admin can set this person's password here (adminSetPassword refuses the same). */
    private updatePasswordNote(currentItem: any): void {
        const shared = currentItem.authOwner === 'shared' || currentItem.authOwner === 'host';
        this.passwordElsewhere.set(isLockedAppAccount(currentItem)
            ? 'admin.users.password_elsewhere.app_managed'
            : shared ? 'admin.users.password_elsewhere.shared'
            : this.emailPin() && currentItem.role !== 'admin'
                ? 'admin.users.password_elsewhere.pin'
                : '');
        this.canSetPassword.set(!!currentItem.email && !this.passwordElsewhere());
    }

    private updateFormData(currentItem: any): void {
        this.lastItem = currentItem;
        this.emailRequired.set(!!currentItem.email);
        this.updatePasswordNote(currentItem);
        const role = typeof currentItem.role === 'string' && currentItem.role ? currentItem.role : 'user';
        this.roleOptions.set(roleChoices(AVAILABLE_ROLES, role));
        const me = this.authState.currentUser() as { id?: string; uid?: string } | null;
        this.ownRecord.set(!!me && ((!!me.uid && currentItem.uid === me.uid) || (!!me.id && currentItem.id === me.id)));
        this.canSetRole.set(!isLockedAppAccount(currentItem) && !this.ownRecord());
        const shared = currentItem.authOwner === 'shared' || currentItem.authOwner === 'host';
        this.currentPhone.set(typeof currentItem.phone === 'string' ? currentItem.phone : '');
        this.canSetPhone.set(!!this.currentPhone() && !!currentItem.uid && !shared && !isLockedAppAccount(currentItem));
        this.closePhone();
        const check = this.globalService.emailValidator();
        this.editForm.controls['email'].setValidators(this.emailRequired()
            ? [Validators.required, check]
            : [(control) => (control.value ? check(control) : null)]);
        this.editForm.patchValue({
            email: currentItem.email ?? '',
            name: currentItem.name,
            role,
        });
        this.editForm.controls['email'].updateValueAndValidity({ emitEvent: false });
    }

    ngOnInit(): void {
        // A change to the new password checks the copy again.
        this.password?.valueChanges.subscribe(() => this.confirmPassword?.updateValueAndValidity({ emitEvent: false }));
        this.editForm.valueChanges.subscribe((value) => {
            const items = this.userStore.items();
            // An empty email is no one's: never a duplicate (many accounts have none).
            this.alreadyExist = value.email
                ? items.find((user) => user.email === value.email && user.id !== this.id)
                : undefined;
            this.clearErrorMessages(this.editForm);
            this.errorMessages = [];
        });
    }

    closeEdit(): void {
        this.editForm.reset();
        this.close.emit();
    }

    onSubmit(): void {
        if (this.editForm.invalid) {
            this.focusFirstInvalidField(this.editForm);
            this.errorMessages = this.getFormErrors(this.editForm);
            return;
        }

        // Check for duplicate email (excluding current user)
        if (this.alreadyExist) {
            return;
        }

        const updatedUser: Partial<UserFormData> = {
            name: this.editForm.value.name,
            email: this.editForm.value.email,
        };
        const password = this.isPasswordUpdateEnabled ? String(this.editForm.value.password ?? '') : '';
        const role = String(this.editForm.value.role ?? '');
        const roleChange = this.canSetRole() && role && role !== (this.lastItem?.role || 'user') ? role : '';
        void this.save(updatedUser, password, roleChange);
    }

    /**
     * The password first, on the sign-in account only (adminSetPassword): never in
     * the record, which the rules refuse. A refused password saves nothing. It goes
     * first because an unverified email may be raised above a member once the admins
     * hold its password. Then the role (adminSetUserRole), which the server may refuse:
     * the last active admin, or an unverified sign-in nobody set a password for. A
     * refused role saves nothing more, and says whether the password was set. Then
     * the name and email in the record.
     */
    private async save(updatedUser: Partial<UserFormData>, password: string, role: string): Promise<void> {
        this.saving.set(true);
        const t = (key: TranslationKey, params?: Record<string, unknown>) => this.t(key, params);
        if (password) {
            try {
                await arcCallable<{ id: string; password: string }, { updated: boolean }>(this.functions, 'adminSetPassword')({ id: this.id, password });
            } catch (error: any) {
                console.error('Error setting password:', error);
                // The server refuses in English; the admin reads why in their own language.
                this.toastService.error(userActionError(error, t, 'admin.users.password_failed'));
                this.saving.set(false);
                return;
            }
        }
        if (role) {
            try {
                await this.userService.setRole(this.id, role);
            } catch (error) {
                console.error('Error changing the role:', error);
                const reason = userActionError(error, t, 'admin.users.role_failed');
                this.toastService.error(password ? this.t('admin.users.password_set_role_failed', { reason }) : reason);
                this.saving.set(false);
                return;
            }
        }
        this.userStore.update(this.id, updatedUser).subscribe({
            next: () => {
                this.saving.set(false);
                this.toastService.success(this.t(password ? 'admin.users.updated_password' : 'admin.users.updated'));
                this.editForm.reset();
                this.close.emit();
            },
            error: (error) => {
                console.error('Error updating user:', error);
                this.saving.set(false);
                this.toastService.error(this.t(password ? 'admin.users.password_set_rest_failed' : 'admin.users.update_failed'));
            },
        });
    }

    openPhone(): void {
        this.newPhone.setValue('');
        this.phoneError.set('');
        this.phoneOpen.set(true);
    }

    closePhone(): void {
        this.phoneOpen.set(false);
        this.phoneError.set('');
    }

    /** The new number goes to the server, which checks it and clears the PIN (adminSetPhone). */
    async savePhone(): Promise<void> {
        const phone = this.newPhone.value.trim();
        if (!phone) {
            this.phoneError.set(this.t('admin.users.errors.invalid_number'));
            return;
        }
        this.phoneSaving.set(true);
        this.phoneError.set('');
        try {
            const result = await this.userService.setPhone(this.id, phone);
            if (!result.updated) {
                this.phoneError.set(this.t('admin.users.phone_same'));
                return;
            }
            // Not read again: that would refill the form over what is typed in it.
            this.currentPhone.set(result.phone);
            if (this.lastItem) this.lastItem = { ...this.lastItem, phone: result.phone, phoneVerified: false };
            this.closePhone();
            this.toastService.success(this.t('admin.users.phone_saved'));
        } catch (error) {
            console.error('Error changing the phone number:', error);
            this.phoneError.set(userActionError(error, (key, params) => this.t(key, params), 'admin.users.phone_failed'));
        } finally {
            this.phoneSaving.set(false);
        }
    }

    showPasswordInput(event: any): void {
        const eventValue = event && event.checked;
        this.isPasswordUpdateEnabled = eventValue;
        const validators: ValidatorFn[] = this.isPasswordUpdateEnabled
            ? [Validators.required, newPasswordValidator(() => ({ email: this.editForm.value.email, name: this.editForm.value.name }))]
            : [];
        this.updateValidators(['password'], validators);
        this.updateValidators(['confirmPassword'], this.isPasswordUpdateEnabled
            ? [Validators.required, sameAsValidator(() => this.password?.value)]
            : []);
    }

    private updateValidators(controls: string[], validators: ValidatorFn[]): void {
        controls.forEach((control) => {
            const formControl = this.editForm.controls[control];
            formControl.setValidators(validators);
            formControl.updateValueAndValidity();
            formControl.setValue('');
        });
    }
}
