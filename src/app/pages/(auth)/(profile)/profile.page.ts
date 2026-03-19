/**
 * Profile Page Component
 *
 * Displays and manages user profile information.
 * Allows users to update their photo, name, email, and password.
 */

import { RouteMeta } from '@analogjs/router';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { BaseComponent } from '../../../../shared/components/base/base.component';
import { AuthState } from '../auth.store';
import MediaManagerComponent from '../../admin/(media)/media.page';

export const routeMeta: RouteMeta = {
  title: 'Profile | Arc CMS',
};

@Component({
  selector: 'arc-profile',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export default class ProfileComponent extends BaseComponent {
  authStore = inject(AuthState);
  private dialog = inject(MatDialog);

  // Section editing states
  isEditingName = signal(false);
  isEditingEmail = signal(false);
  isChangingPassword = signal(false);

  // Feedback
  errorMsg = signal('');
  successMsg = signal('');

  // Per-section loading
  isSavingName = signal(false);
  isSavingEmail = signal(false);
  isSavingPassword = signal(false);

  // Password visibility toggles
  showEmailPassword = signal(false);
  showCurrentPassword = signal(false);
  showNewPassword = signal(false);
  showConfirmPassword = signal(false);

  // Form controls
  nameControl = new FormControl('', [Validators.required, Validators.maxLength(50)]);

  emailForm = new FormGroup({
    email: new FormControl('', [Validators.required, Validators.email]),
    password: new FormControl('', [Validators.required]),
  });

  passwordForm = new FormGroup({
    currentPassword: new FormControl('', [Validators.required]),
    newPassword: new FormControl('', [Validators.required, Validators.minLength(8)]),
    confirmPassword: new FormControl('', [Validators.required]),
  });

  currentUser = computed(() => this.authStore.currentUser());

  get hasPasswordMismatch(): boolean {
    const newPw = this.passwordForm.get('newPassword')?.value;
    const confirmPw = this.passwordForm.get('confirmPassword')?.value;
    return !!(newPw && confirmPw && newPw !== confirmPw && this.passwordForm.get('confirmPassword')?.touched);
  }

  constructor() {
    super();
  }

  getInitials(name: string): string {
    if (!name || !name.trim()) return '?';
    return name
      .trim()
      .split(' ')
      .filter(Boolean)
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .substring(0, 2);
  }

  // --- Photo ---

  openPhotoSelector(): void {
    const dialogRef = this.dialog.open(MediaManagerComponent, {
      enterAnimationDuration: '450ms',
      exitAnimationDuration: '300ms',
      minWidth: '134vh',
      maxHeight: '90vh',
      panelClass: 'common-dialog-box',
      disableClose: true,
      data: { isDialogOpen: true },
    });

    dialogRef.afterClosed().subscribe(async (result: { mediaUrl: string; type: string } | null) => {
      if (result?.type === 'submit' && result.mediaUrl) {
        const user = this.currentUser();
        if (!user) return;

        this.clearMessages();
        await this.authStore.updateUserProfile(user.id, { photo: result.mediaUrl });

        if (this.authStore.isSuccess()) {
          this.successMsg.set('Profile photo updated!');
        } else {
          this.errorMsg.set(this.authStore.error() || 'Failed to update photo');
        }
      }
    });
  }

  async removePhoto(): Promise<void> {
    const user = this.currentUser();
    if (!user) return;

    this.clearMessages();
    await this.authStore.updateUserProfile(user.id, { photo: '' });

    if (this.authStore.isSuccess()) {
      this.successMsg.set('Profile photo removed.');
    } else {
      this.errorMsg.set(this.authStore.error() || 'Failed to remove photo');
    }
  }

  // --- Name ---

  editName(): void {
    this.isEditingName.set(true);
    this.nameControl.setValue(this.currentUser()?.name || '');
    this.clearMessages();
  }

  cancelEditName(): void {
    this.isEditingName.set(false);
    this.clearMessages();
  }

  async saveName(): Promise<void> {
    if (this.nameControl.invalid) {
      this.errorMsg.set('Please enter a valid name');
      return;
    }

    const user = this.currentUser();
    if (!user) return;

    this.isSavingName.set(true);
    this.clearMessages();

    try {
      await this.authStore.updateUserProfile(user.id, {
        name: this.nameControl.value || '',
      });

      if (this.authStore.isSuccess()) {
        this.successMsg.set('Name updated successfully!');
        this.isEditingName.set(false);
      } else {
        this.errorMsg.set(this.authStore.error() || 'Failed to update name');
      }
    } catch (error) {
      this.errorMsg.set('An error occurred while updating name.');
    } finally {
      this.isSavingName.set(false);
    }
  }

  // --- Email ---

  startEditEmail(): void {
    this.isEditingEmail.set(true);
    this.emailForm.patchValue({
      email: '',
      password: '',
    });
    this.clearMessages();
  }

  cancelEditEmail(): void {
    this.isEditingEmail.set(false);
    this.emailForm.reset();
    this.showEmailPassword.set(false);
    this.clearMessages();
  }

  async saveEmail(): Promise<void> {
    if (this.emailForm.invalid) {
      this.emailForm.markAllAsTouched();
      return;
    }

    const user = this.currentUser();
    if (!user) return;

    const newEmail = this.emailForm.get('email')!.value!;
    const password = this.emailForm.get('password')!.value!;

    if (newEmail === user.email) {
      this.errorMsg.set('New email is the same as your current email.');
      return;
    }

    this.isSavingEmail.set(true);
    this.clearMessages();

    try {
      await this.authStore.changeEmail(user.id, user.email, newEmail, password);

      if (this.authStore.isSuccess()) {
        this.successMsg.set('Email updated successfully!');
        this.isEditingEmail.set(false);
        this.emailForm.reset();
      } else {
        this.errorMsg.set(this.authStore.error() || 'Failed to update email');
      }
    } catch (error) {
      this.errorMsg.set('An error occurred while updating email.');
    } finally {
      this.isSavingEmail.set(false);
    }
  }

  // --- Password ---

  startChangePassword(): void {
    this.isChangingPassword.set(true);
    this.passwordForm.reset();
    this.clearMessages();
  }

  cancelChangePassword(): void {
    this.isChangingPassword.set(false);
    this.passwordForm.reset();
    this.clearMessages();
  }

  async savePassword(): Promise<void> {
    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }

    if (this.hasPasswordMismatch) {
      this.errorMsg.set('Passwords do not match.');
      return;
    }

    this.isSavingPassword.set(true);
    this.clearMessages();

    try {
      await this.authStore.changePassword({
        currentPassword: this.passwordForm.get('currentPassword')!.value!,
        newPassword: this.passwordForm.get('newPassword')!.value!,
      });

      if (this.authStore.isSuccess()) {
        this.successMsg.set('Password changed successfully!');
        this.isChangingPassword.set(false);
        this.passwordForm.reset();
      } else {
        this.errorMsg.set(this.authStore.error() || 'Failed to change password');
      }
    } catch (error) {
      this.errorMsg.set('An error occurred while changing password.');
    } finally {
      this.isSavingPassword.set(false);
    }
  }

  // --- Utilities ---

  clearMessages(): void {
    this.errorMsg.set('');
    this.successMsg.set('');
  }

  goBack(): void {
    this.location.back();
  }
}
