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
import { ChangeDetectionStrategy, Component, EventEmitter, inject, Input, input, Output, signal } from '@angular/core';
import { Functions } from '@angular/fire/functions';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { BaseComponent } from '../../../../../shared/components/base/base.component';
import { UserStore } from '../user.store';
import { arcCallable } from '../../../../core/config/arc-functions';
import { roleGuard } from '../../../../guards/role.guard';

export const routeMeta: RouteMeta = {
    title: 'Add User',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

@Component({
    selector: 'arc-add-user',
    standalone: true,
    imports: [ReactiveFormsModule],
    templateUrl: './add-user.html',
    styleUrl: './add-user.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export default class AddUserComponent extends BaseComponent {
    @Output() close = new EventEmitter<void>();
    @Input() role: string | null | undefined;
    action = input('add');

    userStore = inject(UserStore);
    private functions = inject(Functions);
    saving = signal(false);
    errorMessages: string[] = [];
    alreadyExist: any;

    // Add form
    addForm: FormGroup = new FormGroup({
        name: new FormControl('', [Validators.required]),
        email: new FormControl('', [Validators.required, this.globalService.emailValidator()]),
        password: new FormControl('', [Validators.required, Validators.minLength(8)]),
    });

    // Getter methods for form controls
    get name() {
        return this.addForm.get('name');
    }
    get email() {
        return this.addForm.get('email');
    }
    get password() {
        return this.addForm.get('password');
    }

    ngOnInit(): void {
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
        const { name, email, password } = this.addForm.value;
        this.saving.set(true);
        try {
            const res = await arcCallable<
                { name: string; email: string; password: string; role: string },
                { id: string; uid: string; reusedAccount: boolean }
            >(this.functions, 'adminCreateUser')({ name, email, password, role: this.role || 'user' });
            this.toastService.success(res.data.reusedAccount
                ? 'User added. This address already had a sign-in account, so they keep their existing password.'
                : 'User created. Share the temporary password with them.');
            this.addForm.reset();
            this.close.emit();
        } catch (error: any) {
            console.error('Error creating user:', error);
            if (error?.code === 'functions/already-exists') this.alreadyExist = true;
            this.toastService.error(error?.message || 'Failed to create user.');
        } finally {
            this.saving.set(false);
        }
    }
}
