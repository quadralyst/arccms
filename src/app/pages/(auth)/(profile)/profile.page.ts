/**
 * Profile Page Component
 *
 * Displays and manages user profile information.
 * Allows users to update their photo, name and password. Email, phone and
 * Google are managed in the Sign-in methods card (sign-in-methods.component.ts).
 * A locked app account (docs/app/app-accounts.html) sees all of it read-only:
 * no photo or name change, no sign-in methods, no password, no delete.
 */

import { RouteMeta } from '@analogjs/router';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { BaseComponent } from '../../../../shared/components/base/base.component';
import { AuthState } from '../auth.store';
import MediaManagerComponent from '../../admin/(media)/media.page';
import { FileUploadService } from '../../../../shared/services/file-upload.service';
import { readSignInError, SignInService } from '../sign-in.service';
import { ConfirmationPopupComponent } from '../../../../shared/components/confirmation-popup/confirmation-popup.component';
import { firstValueFrom } from 'rxjs';
import { SignInMethodsComponent } from './sign-in-methods.component';
import { TranslocoPipe } from '@jsverse/transloco';
import { isLockedAppAccount } from '../../../core/app-accounts/app-account-lock';

export const routeMeta: RouteMeta = {
  title: 'Profile | Arc CMS',
};

@Component({
  selector: 'arc-profile',
  standalone: true,
  imports: [ReactiveFormsModule, TranslocoPipe, SignInMethodsComponent],
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export default class ProfileComponent extends BaseComponent {
  authStore = inject(AuthState);
  private dialog = inject(MatDialog);
  private fileUpload = inject(FileUploadService);
  private signIn = inject(SignInService);

  // Section editing states
  isEditingName = signal(false);
  isChangingPassword = signal(false);

  // Feedback
  errorMsg = signal('');
  successMsg = signal('');

  // Per-section loading
  isSavingName = signal(false);
  isSavingPassword = signal(false);

  // Password visibility toggles
  showCurrentPassword = signal(false);
  showNewPassword = signal(false);
  showConfirmPassword = signal(false);

  // Form controls
  nameControl = new FormControl('', [Validators.required, Validators.maxLength(50)]);

  passwordForm = new FormGroup({
    currentPassword: new FormControl('', [Validators.required]),
    newPassword: new FormControl('', [Validators.required, Validators.minLength(8)]),
    confirmPassword: new FormControl('', [Validators.required]),
  });

  currentUser = computed(() => this.authStore.currentUser());

  /** An app account its app manages: everything here is read-only (the server refuses changes too). */
  locked = computed(() => isLockedAppAccount(this.currentUser()));

  /** The role in the person's language: Arc CMS's own roles are translated, an app's own shows as it is. */
  roleLabel(): string {
    const role = this.currentUser()?.role;
    if (role === 'admin') return this.t('member.profile.role_admin');
    return role && role !== 'user' ? role : this.t('member.profile.role_user');
  }

  /** Only accounts that sign in with email and password can change a password. */
  hasPassword(): boolean {
    return this.signIn.hasPassword();
  }

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

  async onAvatarFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const user = this.currentUser();
    if (!file || !user?.uid) return;

    this.clearMessages();
    try {
      const url = await this.fileUpload.uploadAvatar(user.uid, file);
      await this.authStore.updateUserProfile(user.id, { photo: url });
      if (this.authStore.isSuccess()) {
        this.successMsg.set(this.t('member.profile.photo_updated'));
      } else {
        this.errorMsg.set(this.authStore.error() || this.t('member.profile.photo_update_failed'));
      }
    } catch (err) {
      this.errorMsg.set(err instanceof Error ? err.message : this.t('member.profile.photo_upload_failed'));
    }
  }

  /**
   * Admins pick from the media library. Everyone else uploads a file to their
   * own `avatars/{uid}/` folder: the media library and its storage paths are
   * staff-only in the rules.
   */
  openPhotoSelector(fileInput?: HTMLInputElement): void {
    if (this.locked()) return;
    if (this.currentUser()?.role !== 'admin') {
      fileInput?.click();
      return;
    }
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
          this.successMsg.set(this.t('member.profile.photo_updated'));
        } else {
          this.errorMsg.set(this.authStore.error() || this.t('member.profile.photo_update_failed'));
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
      this.successMsg.set(this.t('member.profile.photo_removed'));
    } else {
      this.errorMsg.set(this.authStore.error() || this.t('member.profile.photo_remove_failed'));
    }
  }

  // --- Name ---

  editName(): void {
    if (this.locked()) return;
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
      this.errorMsg.set(this.t('member.profile.name_invalid_short'));
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
        this.successMsg.set(this.t('member.profile.name_updated'));
        this.isEditingName.set(false);
      } else {
        this.errorMsg.set(this.authStore.error() || this.t('member.profile.name_update_failed'));
      }
    } catch (error) {
      this.errorMsg.set(this.t('member.profile.name_update_error'));
    } finally {
      this.isSavingName.set(false);
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
      this.errorMsg.set(this.t('member.profile.passwords_mismatch'));
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
        this.successMsg.set(this.t('member.profile.password_changed'));
        this.isChangingPassword.set(false);
        this.passwordForm.reset();
      } else {
        this.errorMsg.set(this.authStore.error() || this.t('member.profile.password_change_failed'));
      }
    } catch (error) {
      this.errorMsg.set(this.t('member.profile.password_change_error'));
    } finally {
      this.isSavingPassword.set(false);
    }
  }

  // --- Delete account ---

  isDeleting = signal(false);
  /** The server wants a fresh sign-in before deleting. */
  deleteNeedsSignIn = signal(false);

  /** Admins are removed by another admin, under Users; a locked app account by its app. */
  canDeleteAccount(): boolean {
    return this.currentUser()?.role !== 'admin' && !this.locked();
  }

  /** Deletes the account and everything stored under it (docs/app/account-contract.html). */
  async deleteAccount(): Promise<void> {
    const confirmed = await firstValueFrom(this.dialog.open(ConfirmationPopupComponent, {
      width: '400px',
      data: {
        dialogType: this.t('member.profile.delete_title'),
        // A fixed sentence from the translation files, with no user data in it.
        dialogMessage: this.sanitizer.bypassSecurityTrustHtml(this.t('member.profile.delete_confirm_body')),
        btnText: this.t('member.profile.delete_my_account'),
        panelType: 'warn',
      },
    }).afterClosed());
    if (!confirmed) return;

    this.clearMessages();
    this.isDeleting.set(true);
    try {
      await this.signIn.deleteMyAccount();
      await firstValueFrom(this.authStore.logout());
      this.toastService.success(this.t('member.profile.account_deleted'));
      await this.router.navigate(['/'], { replaceUrl: true });
    } catch (err) {
      const error = readSignInError(err);
      this.deleteNeedsSignIn.set(error.reason === 'recent-sign-in');
      this.errorMsg.set(error.message);
    } finally {
      this.isDeleting.set(false);
    }
  }

  /** Sign out, to sign in again before deleting. */
  async signInAgain(): Promise<void> {
    await firstValueFrom(this.authStore.logout());
    await this.router.navigate(['/signup']);
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
