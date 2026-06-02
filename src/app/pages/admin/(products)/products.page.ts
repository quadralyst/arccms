import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTableModule } from '@angular/material/table';
import { BaseComponent } from '../../../../shared/components/base/base.component';
import { roleGuard } from '../../../guards/role.guard';
import { ProductsStore } from './products.store';
import { IProduct } from './product.model';

export const routeMeta: RouteMeta = {
    title: 'Products | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

@Component({
    standalone: true,
    imports: [
        CommonModule, ReactiveFormsModule, MatCardModule, MatButtonModule, MatIconModule,
        MatFormFieldModule, MatInputModule, MatSelectModule, MatSlideToggleModule, MatTableModule,
    ],
    template: `
        <div class="products-page">
            <div class="d-flex justify-content-between align-items-center mb-3">
                <div>
                    <h1 class="m-0">Products</h1>
                    <p class="text-muted mb-0">Products are created in Dodo; mirror them here with pricing tiers & entitlements.</p>
                </div>
                @if (!showForm()) {
                    <button mat-raised-button color="primary" (click)="openCreate()"><i class="fa-solid fa-plus me-2"></i>New Product</button>
                }
            </div>

            @if (showForm()) {
                <mat-card class="mb-4">
                    <mat-card-content class="pt-3">
                        <form [formGroup]="form" (ngSubmit)="save()">
                            <div class="row">
                                <div class="col-md-6">
                                    <mat-form-field appearance="outline" class="w-100">
                                        <mat-label>Name</mat-label>
                                        <input matInput formControlName="name" />
                                    </mat-form-field>
                                </div>
                                <div class="col-md-6">
                                    <mat-form-field appearance="outline" class="w-100">
                                        <mat-label>Dodo Product ID</mat-label>
                                        <input matInput formControlName="dodoProductId" placeholder="prod_..." />
                                    </mat-form-field>
                                </div>
                            </div>
                            <mat-form-field appearance="outline" class="w-100">
                                <mat-label>Description</mat-label>
                                <textarea matInput rows="2" formControlName="description"></textarea>
                            </mat-form-field>
                            <div class="row">
                                <div class="col-md-3">
                                    <mat-form-field appearance="outline" class="w-100">
                                        <mat-label>Type</mat-label>
                                        <mat-select formControlName="type">
                                            <mat-option value="one_time">One-time</mat-option>
                                            <mat-option value="subscription">Subscription</mat-option>
                                        </mat-select>
                                    </mat-form-field>
                                </div>
                                @if (form.get('type')?.value === 'subscription') {
                                    <div class="col-md-3">
                                        <mat-form-field appearance="outline" class="w-100">
                                            <mat-label>Interval</mat-label>
                                            <mat-select formControlName="interval">
                                                <mat-option value="month">Monthly</mat-option>
                                                <mat-option value="year">Yearly</mat-option>
                                            </mat-select>
                                        </mat-form-field>
                                    </div>
                                    <div class="col-md-3">
                                        <mat-form-field appearance="outline" class="w-100">
                                            <mat-label>Trial days</mat-label>
                                            <input matInput type="number" formControlName="trialDays" />
                                        </mat-form-field>
                                    </div>
                                }
                            </div>
                            <div class="row">
                                <div class="col-md-3">
                                    <mat-form-field appearance="outline" class="w-100">
                                        <mat-label>Premium type</mat-label>
                                        <input matInput formControlName="premiumType" placeholder="gold" />
                                    </mat-form-field>
                                </div>
                                <div class="col-md-3">
                                    <mat-form-field appearance="outline" class="w-100">
                                        <mat-label>Tier rank</mat-label>
                                        <input matInput type="number" formControlName="tierRank" />
                                        <mat-hint>Higher = more access</mat-hint>
                                    </mat-form-field>
                                </div>
                                <div class="col-md-3 d-flex align-items-center">
                                    <mat-slide-toggle formControlName="active" color="primary">Active</mat-slide-toggle>
                                </div>
                            </div>

                            <!-- Pricing tiers -->
                            <div class="tiers-section">
                                <div class="d-flex justify-content-between align-items-center mb-2">
                                    <h6 class="m-0">Pricing tiers</h6>
                                    <button mat-stroked-button type="button" (click)="addTier()"><i class="fa-solid fa-plus me-1"></i>Add tier</button>
                                </div>
                                <p class="text-muted small">Buyers are assigned the first tier whose cumulative limit isn't exceeded. Set limit to 0 for the final "everyone else" tier. The discount code must exist in Dodo (its redemption limit enforces the cap).</p>
                                <div formArrayName="tiers">
                                    @for (tier of tiers.controls; track $index; let i = $index) {
                                        <div class="row tier-row" [formGroupName]="i">
                                            <div class="col-md-3"><mat-form-field appearance="outline" class="w-100"><mat-label>Label</mat-label><input matInput formControlName="label" /></mat-form-field></div>
                                            <div class="col-md-2"><mat-form-field appearance="outline" class="w-100"><mat-label>Limit</mat-label><input matInput type="number" formControlName="maxCount" /></mat-form-field></div>
                                            <div class="col-md-3"><mat-form-field appearance="outline" class="w-100"><mat-label>Discount code</mat-label><input matInput formControlName="discountCode" /></mat-form-field></div>
                                            <div class="col-md-2"><mat-form-field appearance="outline" class="w-100"><mat-label>Off %</mat-label><input matInput type="number" formControlName="discountPct" /></mat-form-field></div>
                                            <div class="col-md-2 d-flex align-items-center"><button mat-icon-button color="warn" type="button" (click)="removeTier(i)"><mat-icon>delete</mat-icon></button></div>
                                        </div>
                                    }
                                </div>
                            </div>

                            <div class="d-flex justify-content-end gap-2 mt-3">
                                <button mat-stroked-button type="button" (click)="closeForm()">Cancel</button>
                                <button mat-raised-button color="primary" type="submit" [disabled]="form.invalid">Save Product</button>
                            </div>
                        </form>
                    </mat-card-content>
                </mat-card>
            }

            <mat-card>
                <mat-card-content class="pt-3">
                    @if (store.isLoading()) {
                        <p class="text-muted">Loading…</p>
                    } @else if (store.items().length === 0) {
                        <p class="text-muted">No products yet.</p>
                    } @else {
                        <table mat-table [dataSource]="store.items()" class="w-100">
                            <ng-container matColumnDef="name"><th mat-header-cell *matHeaderCellDef>Name</th><td mat-cell *matCellDef="let p">{{ p.name }}</td></ng-container>
                            <ng-container matColumnDef="type"><th mat-header-cell *matHeaderCellDef>Type</th><td mat-cell *matCellDef="let p">{{ p.type }}</td></ng-container>
                            <ng-container matColumnDef="premiumType"><th mat-header-cell *matHeaderCellDef>Tier</th><td mat-cell *matCellDef="let p">{{ p.premiumType }} (#{{ p.tierRank }})</td></ng-container>
                            <ng-container matColumnDef="purchaseCount"><th mat-header-cell *matHeaderCellDef>Sold</th><td mat-cell *matCellDef="let p">{{ p.purchaseCount || 0 }}</td></ng-container>
                            <ng-container matColumnDef="active"><th mat-header-cell *matHeaderCellDef>Active</th><td mat-cell *matCellDef="let p">{{ p.active ? 'Yes' : 'No' }}</td></ng-container>
                            <ng-container matColumnDef="actions">
                                <th mat-header-cell *matHeaderCellDef></th>
                                <td mat-cell *matCellDef="let p">
                                    <button mat-icon-button (click)="openEdit(p)"><mat-icon>edit</mat-icon></button>
                                    <button mat-icon-button color="warn" (click)="remove(p)"><mat-icon>delete</mat-icon></button>
                                </td>
                            </ng-container>
                            <tr mat-header-row *matHeaderRowDef="columns"></tr>
                            <tr mat-row *matRowDef="let row; columns: columns"></tr>
                        </table>
                    }
                </mat-card-content>
            </mat-card>
        </div>
    `,
    styles: [`
        .products-page { padding: 24px; }
        .tiers-section { border: 1px solid #e9ecef; border-radius: 8px; padding: 16px; margin-top: 8px; background: #fafbfc; }
        .tier-row { align-items: center; }
        table { background: #fff; }
    `],
})
export default class ProductsPageComponent extends BaseComponent implements OnInit {
    private fb = inject(FormBuilder);
    store = inject(ProductsStore);

    columns = ['name', 'type', 'premiumType', 'purchaseCount', 'active', 'actions'];
    showForm = signal(false);
    editingId = signal<string | null>(null);
    form!: FormGroup;

    get tiers(): FormArray {
        return this.form.get('tiers') as FormArray;
    }

    ngOnInit(): void {
        this.buildForm();
        this.store.getAll({ currentPageNumber: 0 });
    }

    private buildForm(): void {
        this.form = this.fb.group({
            name: ['', Validators.required],
            dodoProductId: ['', Validators.required],
            description: [''],
            type: ['subscription', Validators.required],
            interval: ['month'],
            trialDays: [0],
            premiumType: ['', Validators.required],
            tierRank: [1, Validators.required],
            active: [true],
            tiers: this.fb.array([]),
        });
    }

    private tierGroup(t?: Partial<{ label: string; maxCount: number; discountCode: string; discountPct: number }>): FormGroup {
        return this.fb.group({
            label: [t?.label ?? ''],
            maxCount: [t?.maxCount ?? 0],
            discountCode: [t?.discountCode ?? ''],
            discountPct: [t?.discountPct ?? 0],
        });
    }

    addTier(): void {
        this.tiers.push(this.tierGroup());
    }

    removeTier(i: number): void {
        this.tiers.removeAt(i);
    }

    openCreate(): void {
        this.editingId.set(null);
        this.buildForm();
        this.showForm.set(true);
    }

    openEdit(p: IProduct): void {
        this.editingId.set(p.id);
        this.buildForm();
        this.form.patchValue({
            name: p.name, dodoProductId: p.dodoProductId, description: p.description ?? '',
            type: p.type, interval: p.interval ?? 'month', trialDays: p.trialDays ?? 0,
            premiumType: p.premiumType, tierRank: p.tierRank, active: p.active,
        });
        (p.tiers ?? []).forEach((t) => this.tiers.push(this.tierGroup(t)));
        this.showForm.set(true);
    }

    closeForm(): void {
        this.showForm.set(false);
    }

    save(): void {
        if (this.form.invalid) return;
        const v = this.form.getRawValue();
        const payload = {
            name: v.name,
            dodoProductId: v.dodoProductId,
            description: v.description,
            type: v.type,
            interval: v.type === 'subscription' ? v.interval : undefined,
            trialDays: v.type === 'subscription' ? Number(v.trialDays) || 0 : 0,
            premiumType: v.premiumType,
            tierRank: Number(v.tierRank) || 0,
            active: v.active,
            tiers: (v.tiers ?? []).map((t: { label: string; maxCount: number; discountCode: string; discountPct: number }) => ({
                label: t.label, maxCount: Number(t.maxCount) || 0, discountCode: t.discountCode, discountPct: Number(t.discountPct) || 0,
            })),
            features: [],
        };

        const editingId = this.editingId();
        if (editingId) {
            this.store.update(editingId, payload).subscribe({
                next: () => { this.toastService.success('Product updated.'); this.closeForm(); },
                error: () => this.toastService.error('Failed to update product.'),
            });
        } else {
            // purchaseCount starts at 0 for new products.
            this.store.add({ ...payload, purchaseCount: 0 } as never).subscribe({
                next: () => { this.toastService.success('Product created.'); this.closeForm(); this.store.getAll({ currentPageNumber: 0 }); },
                error: () => this.toastService.error('Failed to create product.'),
            });
        }
    }

    remove(p: IProduct): void {
        if (!confirm(`Delete product "${p.name}"?`)) return;
        this.store.delete(p.id).subscribe({
            next: () => this.toastService.success('Product deleted.'),
            error: () => this.toastService.error('Failed to delete product.'),
        });
    }
}
