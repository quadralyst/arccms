/**
 * Add User Component
 * 
 * Form component for creating new users.
 */

import { RouteMeta } from '@analogjs/router';
import { ChangeDetectionStrategy, Component, EventEmitter, inject, Input, input, Output } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { BaseComponent } from '../../../../../shared/components/base/base.component';
import { UserFormData } from '../user.model';
import { UserStore } from '../user.store';
import { roleGuard } from '../../../../guards/role.guard';

export const routeMeta: RouteMeta = {
    title: 'Add User | Arc CMS',
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

        const newUser: UserFormData = {
            ...this.addForm.value,
            role: this.role || 'user',
            emailVerified: false,
            status: 'Active',
            isActive: true,
            by: 'admin',
        };

        this.userStore.add(newUser).subscribe({
            next: () => {
                this.toastService.success('User created successfully.');
                this.addForm.reset();
                this.close.emit();
            },
            error: (error) => {
                console.error('Error creating user:', error);
                this.toastService.error('Failed to create user.');
            },
        });
    }
}
