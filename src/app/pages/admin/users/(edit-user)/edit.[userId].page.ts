/**
 * Edit User Component
 * 
 * Form component for editing existing users.
 */

import { RouteMeta } from '@analogjs/router';
import { ChangeDetectionStrategy, Component, computed, EventEmitter, inject, Input, input, Output } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { BaseComponent } from '../../../../../shared/components/base/base.component';
import { UserFormData } from '../user.model';
import { UserStore } from '../user.store';
import { roleGuard } from '../../../../guards/role.guard';

export const routeMeta: RouteMeta = {
    title: 'Edit User | Arc CMS',
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
    @Output() close = new EventEmitter<void>();
    @Input() role: string | null | undefined;
    action = input('edit');

    userStore = inject(UserStore);
    errorMessages: string[] = [];
    isPasswordUpdateEnabled: boolean = false;
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

    // Current user data
    currentUser = computed(() => {
        const item = this.userStore.currentItem();
        if (item) {
            this.updateFormData(item);
        }
        return item;
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

    private updateFormData(currentItem: any): void {
        this.editForm.patchValue({
            email: currentItem.email,
            name: currentItem.name,
        });
    }

    ngOnInit(): void {
        this.editForm.valueChanges.subscribe((value) => {
            const items = this.userStore.items();
            this.alreadyExist = items.find(
                (user) => user.email === value.email && user.id !== this.id
            );
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

        // Only include password if update is enabled and password is provided
        if (this.isPasswordUpdateEnabled && this.editForm.value.password) {
            updatedUser.password = this.editForm.value.password;
        }

        this.userStore.update(this.id, updatedUser).subscribe({
            next: () => {
                this.toastService.success('User updated successfully.');
                this.editForm.reset();
                this.close.emit();
            },
            error: (error) => {
                console.error('Error updating user:', error);
                this.toastService.error('Failed to update user.');
            },
        });
    }

    showPasswordInput(event: any): void {
        const eventValue = event && event.checked;
        this.isPasswordUpdateEnabled = eventValue;
        const validators: ValidatorFn[] = this.isPasswordUpdateEnabled
            ? [Validators.required, Validators.minLength(8)]
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
