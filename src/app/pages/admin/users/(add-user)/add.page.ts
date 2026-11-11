/**
 * Add User Component
 *
 * Creates a user through the `adminCreateUser` callable (CO6.6): the sign-in
 * account and the `users` record together, with a temporary password that is
 * never stored in the record. When the address already has a sign-in account
 * (a user of another app sharing this project), that account is reused and
 * keeps its own password.
 */

import { RouteMeta } from '@analogjs/router';
import { SiteBrandService } from '../../../../core/brand/site-brand';
import { ChangeDetectionStrategy, Component, EventEmitter, inject, Input, input, Output, signal } from '@angular/core';
import { Functions } from '@angular/fire/functions';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { BaseComponent, UserRole } from '../../../../../shared/components/base/base.component';
import { UserStore } from '../user.store';
import { arcCallable } from '../../../../core/config/arc-functions';
import { roleGuard } from '../../../../guards/role.guard';
import { newPasswordValidator, passwordProblemOf, sameAsValidator } from '../../../../../shared/utils/password-validator';
import { minPasswordLength } from '../../../../../shared/utils/password-rule';
import { SIGN_IN_STRENGTH } from '../../../../core/sign-in/sign-in-strength';
import { TranslocoPipe } from '@jsverse/transloco';
import { AVAILABLE_ROLES } from '../../(settings)/user-setting/user-setting.model';
import { passwordProblemMessage, roleChoices, roleLabel, userActionError } from '../user.model';

export const routeMeta: RouteMeta = {
    title: 'Add user',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

@Component({
    selector: 'arc-add-user',
    standalone: true,
    imports: [ReactiveFormsModule, TranslocoPipe],
    templateUrl: './add-user.html',
    styleUrl: './add-user.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export default class AddUserComponent extends BaseComponent {
    /** The site's name for the footer (core/brand/site-brand.ts). */
    readonly siteName = inject(SiteBrandService).name;
    @Output() close = new EventEmitter<void>();
    @Input() role: string | null | undefined;
    action = input('add');

    userStore = inject(UserStore);
    private functions = inject(Functions);
    saving = signal(false);
    errorMessages: string[] = [];
    alreadyExist: any;
    /** The roles to choose from (Settings, Users lists them): a second admin can be made here. */
    /**
     * The known roles, and the role of the list this was opened from (users/[role],
     * such as propertyOwner) when it is another role Arc CMS knows, so the person is
     * added to the list the admin is looking at.
     */
    get roleOptions(): string[] {
        return roleChoices(AVAILABLE_ROLES, this.listRole());
    }

    /** The role of the list this was opened from, when it is one Arc CMS knows. */
    private listRole(): string | null {
        return this.role && (Object.values(UserRole) as string[]).includes(this.role) ? this.role : null;
    }
    readonly roleName = (role: string) => roleLabel(role, (key) => this.t(key));

    // Add form
    addForm: FormGroup = new FormGroup({
        name: new FormControl('', [Validators.required]),
        email: new FormControl('', [Validators.required, this.globalService.emailValidator()]),
        // The rule every new password meets (F22); the server checks it too.
        password: new FormControl('', [Validators.required, newPasswordValidator(() => ({ email: this.addForm?.value.email, name: this.addForm?.value.name }))]),
        // Typed twice, so a typo never sets a password nobody knows.
        confirmPassword: new FormControl('', [Validators.required, sameAsValidator(() => this.addForm?.get('password')?.value)]),
        role: new FormControl('user', { nonNullable: true }),
    });

    // Getter methods for form controls
    get name() {
        return this.addForm.get('name');
    }
    get email() {
        return this.addForm.get('email');
    }
    /** The shortest password the site takes, for the hint in the box. */
    readonly minPassword = minPasswordLength(SIGN_IN_STRENGTH);

    /** Why the temporary password was refused, in the admin's language. */
    passwordError(): string {
        return passwordProblemMessage(passwordProblemOf(this.password), (key, params) => this.t(key, params), SIGN_IN_STRENGTH);
    }

    get password() {
        return this.addForm.get('password');
    }
    get confirmPassword() {
        return this.addForm.get('confirmPassword');
    }

    ngOnInit(): void {
        // A list opened for one role (users/[role]) adds that role unless the admin picks another.
        const listRole = this.listRole();
        if (listRole) this.addForm.controls['role'].setValue(listRole);
        // A change to the password checks the copy again.
        this.password?.valueChanges.subscribe(() => this.confirmPassword?.updateValueAndValidity({ emitEvent: false }));
        this.addForm.valueChanges.subscribe((value) => {
            this.alreadyExist = this.userStore.items().find((user) => user.email === value.email);
            this.clearErrorMessages(this.addForm);
            this.errorMessages = [];
        });
    }

    closeAdd(): void {
        this.addForm.reset();
        this.close.emit();
    }

    onSubmit(): void {
        if (this.addForm.invalid) {
            this.focusFirstInvalidField(this.addForm);
            this.errorMessages = this.getFormErrors(this.addForm);
            return;
        }

        // Check for duplicate email
        if (this.userStore.items().find((user) => user.email === this.addForm.value.email)) {
            this.alreadyExist = true;
            return;
        }

        void this.create();
    }

    private async create(): Promise<void> {
        const { name, email, password, role } = this.addForm.value;
        this.saving.set(true);
        try {
            const res = await arcCallable<
                { name: string; email: string; password: string; role: string },
                { id: string; uid: string; reusedAccount: boolean }
            >(this.functions, 'adminCreateUser')({ name, email, password, role: role || 'user' });
            this.toastService.success(this.t(res.data.reusedAccount ? 'admin.users.created_reused' : 'admin.users.created'));
            this.addForm.reset();
            this.close.emit();
        } catch (error: any) {
            console.error('Error creating user:', error);
            if (error?.code === 'functions/already-exists') this.alreadyExist = true;
            // The server refuses in English; the admin reads why in their own language.
            // An unverified sign-in can still be added as a User: say so, not Edit user's way out.
            const unverified = (error as { details?: { reason?: unknown } } | null)?.details?.reason === 'unverified-account';
            this.toastService.error(unverified
                ? this.t('admin.users.errors.unverified_add')
                : userActionError(error, (key, params) => this.t(key, params), 'admin.users.create_failed'));
        } finally {
            this.saving.set(false);
        }
    }
}
