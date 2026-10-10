/**
 * Edit User Component
 * 
 * Form component for editing existing users.
 */

import { RouteMeta } from '@analogjs/router';
import { SiteBrandService } from '../../../../core/brand/site-brand';
import { ChangeDetectionStrategy, Component, effect, EventEmitter, inject, Input, input, Output, signal, untracked } from '@angular/core';
import { Functions } from '@angular/fire/functions';
import { FormControl, FormGroup, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { BaseComponent } from '../../../../../shared/components/base/base.component';
import { UserFormData } from '../user.model';
import { UserStore } from '../user.store';
import { roleGuard } from '../../../../guards/role.guard';
import { arcCallable } from '../../../../core/config/arc-functions';
import { isLockedAppAccount } from '../../../../core/app-accounts/app-account-lock';
import { newPasswordValidator, passwordProblemOf } from '../../../../../shared/utils/password-validator';
import { passwordProblemText } from '../../../../../shared/utils/password-rule';
import { SIGN_IN_STRENGTH } from '../../../../core/sign-in/sign-in-strength';

export const routeMeta: RouteMeta = {
    title: 'Edit User',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

@Component({
    selector: 'arc-edit-user',
    standalone: true,
    imports: [ReactiveFormsModule, MatSlideToggleModule],
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
    private functions = inject(Functions);
    saving = signal(false);
    errorMessages: string[] = [];
    isPasswordUpdateEnabled: boolean = false;
    /**
     * Whether an admin can set this person's password here: they have an email, and
     * their sign-in is Arc CMS's own (adminSetPassword refuses the rest).
     */
    canSetPassword = signal(false);
    /** Why their password is changed elsewhere, or empty. */
    passwordElsewhere = signal('');
    alreadyExist: any;

    // Edit form
    editForm: FormGroup = new FormGroup({
        name: new FormControl('', [Validators.required]),
        email: new FormControl('', [Validators.required, this.globalService.emailValidator()]),
        password: new FormControl('', []),
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
    /** Why the new password was refused. */
    passwordError(): string {
        return passwordProblemText(passwordProblemOf(this.password) ?? 'short', SIGN_IN_STRENGTH);
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

    private updateFormData(currentItem: any): void {
        this.emailRequired.set(!!currentItem.email);
        const shared = currentItem.authOwner === 'shared' || currentItem.authOwner === 'host';
        this.passwordElsewhere.set(isLockedAppAccount(currentItem)
            ? 'This account is managed by the app that made it, so its password is changed there.'
            : shared ? "This person's sign-in is shared with another app, so their password is changed there." : '');
        this.canSetPassword.set(!!currentItem.email && !this.passwordElsewhere());
        const check = this.globalService.emailValidator();
        this.editForm.controls['email'].setValidators(this.emailRequired()
            ? [Validators.required, check]
            : [(control) => (control.value ? check(control) : null)]);
        this.editForm.patchValue({
            email: currentItem.email ?? '',
            name: currentItem.name,
        });
        this.editForm.controls['email'].updateValueAndValidity({ emitEvent: false });
    }

    ngOnInit(): void {
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
        void this.save(updatedUser, password);
    }

    /**
     * The password first, on the sign-in account only (adminSetPassword): never in
     * the record, which the rules refuse. A refused password saves nothing.
     */
    private async save(updatedUser: Partial<UserFormData>, password: string): Promise<void> {
        this.saving.set(true);
        if (password) {
            try {
                await arcCallable<{ id: string; password: string }, { updated: boolean }>(this.functions, 'adminSetPassword')({ id: this.id, password });
            } catch (error: any) {
                console.error('Error setting password:', error);
                this.toastService.error(error?.message || 'Failed to set the password.');
                this.saving.set(false);
                return;
            }
        }
        this.userStore.update(this.id, updatedUser).subscribe({
            next: () => {
                this.saving.set(false);
                this.toastService.success(password ? 'User updated. Share the new password with them.' : 'User updated successfully.');
                this.editForm.reset();
                this.close.emit();
            },
            error: (error) => {
                console.error('Error updating user:', error);
                this.saving.set(false);
                this.toastService.error(password ? 'The password is set, but the other changes were not saved.' : 'Failed to update user.');
            },
        });
    }

    showPasswordInput(event: any): void {
        const eventValue = event && event.checked;
        this.isPasswordUpdateEnabled = eventValue;
        const validators: ValidatorFn[] = this.isPasswordUpdateEnabled
            ? [Validators.required, newPasswordValidator(() => ({ email: this.editForm.value.email, name: this.editForm.value.name }))]
            : [];
        this.updateValidators(['password'], validators);
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
