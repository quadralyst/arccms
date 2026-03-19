import { FormGroup } from '@angular/forms';

/**
 * Contract that every email provider component must implement.
 * The parent email settings page uses this interface to interact
 * with whichever provider is currently active.
 */
export interface IEmailProviderComponent {
    /** The reactive FormGroup for this provider's config fields */
    formGroup: FormGroup;

    /**
     * Returns true if the minimum required fields are filled in.
     * Used by the parent to gate "Test Connection" and "Save" buttons.
     */
    isConfigValid(): boolean;

    /**
     * Returns a constraint on the parent-level senderEmail field, or null.
     * For Gmail, this returns the gmail user value so the parent can lock the field.
     */
    getSenderEmailConstraint(): string | null;
}
