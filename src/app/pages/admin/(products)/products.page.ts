import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal, ViewChild } from '@angular/core';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDrawer, MatSidenavModule } from '@angular/material/sidenav';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Functions, httpsCallable } from '@angular/fire/functions';
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
        MatSidenavModule, MatTooltipModule, MatProgressSpinnerModule,
    ],
    template: `
      <mat-drawer-container class="products-drawer-container" hasBackdrop="true">
        <!-- ═══════════ Right-side detail panel ═══════════ -->
        <mat-drawer #drawer mode="over" position="end" class="detail-drawer">
          @if (selected(); as p) {
            <div class="detail-panel">
              <div class="detail-header">
                <div>
                  <h5 class="m-0">{{ p.name }}</h5>
                  <span class="status-badge" [class.on]="p.active">{{ p.active ? 'Active' : 'Inactive' }}</span>
                </div>
                <button mat-icon-button (click)="closeDetail()"><mat-icon>close</mat-icon></button>
              </div>

              <div class="detail-body">
                @if (p.description) { <p class="desc">{{ p.description }}</p> }

                <div class="field"><span class="k">Dodo Product ID</span><span class="v mono">{{ p.providerProductIds?.dodo || '—' }}</span></div>
                <div class="field"><span class="k">Type</span><span class="v">{{ p.type === 'subscription' ? 'Subscription' : 'One-time' }}</span></div>
                @if (p.type === 'subscription') {
                  <div class="field"><span class="k">Interval</span><span class="v">{{ p.interval === 'year' ? 'Yearly' : 'Monthly' }}</span></div>
                  <div class="field"><span class="k">Trial</span><span class="v">{{ p.trialDays ? p.trialDays + ' days' : 'None' }}</span></div>
                }
                <div class="field"><span class="k">Premium type</span><span class="v"><code>{{ p.premiumType }}</code></span></div>
                <div class="field"><span class="k">Tier rank</span><span class="v">#{{ p.tierRank }} <small class="text-muted">(higher = more access)</small></span></div>
                <div class="field"><span class="k">Confirmed sales</span><span class="v">{{ p.purchaseCount || 0 }}</span></div>
                @if (p.createdAt) { <div class="field"><span class="k">Created</span><span class="v">{{ p.createdAt | date:'medium' }}</span></div> }

                @if (p.features?.length) {
                  <div class="section-label">Features</div>
                  <ul class="features">@for (f of p.features; track f) { <li>{{ f }}</li> }</ul>
                }

                <div class="section-label">Pricing tiers</div>
                @if (p.tiers.length) {
                  <table class="tiers-table">
                    <thead><tr><th>Tier</th><th>Up to</th><th>Code</th><th>Off</th><th>Test payment link</th></tr></thead>
                    <tbody>
                      @for (t of p.tiers; track $index; let i = $index) {
                        <tr>
                          <td>{{ t.label || '—' }}</td>
                          <td>{{ t.maxCount && t.maxCount > 0 ? t.maxCount : 'Everyone else' }}</td>
                          <td>{{ t.discountCode || '—' }}</td>
                          <td>{{ t.discountPct ? t.discountPct + '%' : '—' }}</td>
                          <td class="link-cell">
                            @if (testLinks()[i]; as url) {
                              <div class="link-row">
                                <input class="link-input" readonly [value]="url" (click)="selectAll($event)" />
                                <button mat-icon-button matTooltip="Copy link" (click)="copyLink(url)"><mat-icon>content_copy</mat-icon></button>
                                <a mat-icon-button matTooltip="Open in new tab" [href]="url" target="_blank" rel="noopener"><mat-icon>open_in_new</mat-icon></a>
                              </div>
                            } @else {
                              <button mat-stroked-button class="gen-btn" (click)="generateTestLink(p, i, t.discountCode)" [disabled]="generatingTier() === i">
                                @if (generatingTier() === i) {
                                  <span class="btn-inner"><mat-spinner diameter="16" class="me-1"></mat-spinner> Generating…</span>
                                } @else {
                                  <span class="btn-inner"><mat-icon class="me-1">link</mat-icon> Generate</span>
                                }
                              </button>
                            }
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                  <p class="text-muted small mt-2 mb-0">Links create a real Dodo checkout session applying that tier's code — open one to verify its price. They expire after 24h.</p>
                } @else {
                  <p class="text-muted small m-0">No tiers — sells at full price.</p>
                }
              </div>

              <div class="detail-footer">
                <button mat-stroked-button (click)="closeDetail()">Close</button>
                <button mat-raised-button color="primary" (click)="editFromDetail(p)"><mat-icon>edit</mat-icon> Edit</button>
              </div>
            </div>
          }
        </mat-drawer>

        <mat-drawer-content>
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
                                @if (form.get('type')?.value === 'one_time') {
                                    <div class="col-md-3">
                                        <mat-form-field appearance="outline" class="w-100">
                                            <mat-label>Free-updates years</mat-label>
                                            <input matInput type="number" formControlName="updatesYears" />
                                            <mat-hint>Lifetime access; updates for N years</mat-hint>
                                        </mat-form-field>
                                    </div>
                                }
                                <div class="col-md-3">
                                    <mat-form-field appearance="outline" class="w-100">
                                        <mat-label>Credits granted</mat-label>
                                        <input matInput type="number" formControlName="creditsGranted" />
                                        <mat-hint>{{ form.get('type')?.value === 'subscription' ? 'Per renewal' : 'Per purchase' }} · 0 = none</mat-hint>
                                    </mat-form-field>
                                </div>
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

                            <div class="row">
                                <div class="col-md-3">
                                    <mat-form-field appearance="outline" class="w-100">
                                        <mat-label>List price</mat-label>
                                        <input matInput type="number" formControlName="price" />
                                        <mat-hint>Display only</mat-hint>
                                    </mat-form-field>
                                </div>
                                <div class="col-md-3">
                                    <mat-form-field appearance="outline" class="w-100">
                                        <mat-label>Currency</mat-label>
                                        <input matInput formControlName="currency" placeholder="USD" />
                                    </mat-form-field>
                                </div>
                            </div>

                            <!-- Pricing tiers -->
                            <div class="tiers-section">
                                <div class="d-flex justify-content-between align-items-center mb-2">
                                    <h6 class="m-0">Pricing tiers</h6>
                                    <button mat-stroked-button type="button" (click)="addTier()"><i class="fa-solid fa-plus me-1"></i>Add tier</button>
                                </div>
                                <p class="text-muted small">Buyers are assigned the first tier whose cumulative limit isn't exceeded. Set limit to 0 for the final "everyone else" tier. The discount code must exist in Dodo (its redemption limit enforces the cap).</p>
                                @if (form.get('type')?.value === 'subscription') {
                                    <p class="text-warning small"><i class="fa-solid fa-triangle-exclamation me-1"></i><strong>Grandfathering:</strong> for subscription tiers, the Dodo discount code must be configured as <strong>recurring</strong> so the early-bird price persists on every renewal. A one-time code only discounts the first payment.</p>
                                }
                                <div formArrayName="tiers">
                                    @for (tier of tiers.controls; track $index; let i = $index) {
                                        <div class="row tier-row" [formGroupName]="i">
                                            <div class="col-md-2"><mat-form-field appearance="outline" class="w-100"><mat-label>Label</mat-label><input matInput formControlName="label" /></mat-form-field></div>
                                            <div class="col-md-2"><mat-form-field appearance="outline" class="w-100"><mat-label>Limit</mat-label><input matInput type="number" formControlName="maxCount" /></mat-form-field></div>
                                            <div class="col-md-3"><mat-form-field appearance="outline" class="w-100"><mat-label>Discount code</mat-label><input matInput formControlName="discountCode" /></mat-form-field></div>
                                            <div class="col-md-1"><mat-form-field appearance="outline" class="w-100"><mat-label>Off %</mat-label><input matInput type="number" formControlName="discountPct" /></mat-form-field></div>
                                            <div class="col-md-2"><mat-form-field appearance="outline" class="w-100"><mat-label>Price</mat-label><input matInput type="number" formControlName="price" /></mat-form-field></div>
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
                                    <button mat-icon-button matTooltip="View details" (click)="viewProduct(p)"><mat-icon>visibility</mat-icon></button>
                                    <button mat-icon-button matTooltip="Edit" (click)="editProduct(p)"><mat-icon>edit</mat-icon></button>
                                    <button mat-icon-button color="warn" matTooltip="Delete" (click)="remove(p)"><mat-icon>delete</mat-icon></button>
                                </td>
                            </ng-container>
                            <tr mat-header-row *matHeaderRowDef="columns"></tr>
                            <tr mat-row *matRowDef="let row; columns: columns"></tr>
                        </table>
                    }
                </mat-card-content>
            </mat-card>
        </div>
        </mat-drawer-content>
      </mat-drawer-container>
    `,
    styles: [`
        :host { display: block; }
        .products-drawer-container { min-height: 100vh; background: transparent; }
        .products-page { padding: 24px; }
        .tiers-section { border: 1px solid #e9ecef; border-radius: 8px; padding: 16px; margin-top: 8px; background: #fafbfc; }
        .tier-row { align-items: center; }
        table { background: #fff; }

        /* Detail panel */
        .detail-drawer { width: 460px; max-width: 90vw; }
        .detail-panel { display: flex; flex-direction: column; height: 100%; }
        .detail-header { display: flex; justify-content: space-between; align-items: flex-start; padding: 20px 20px 12px; border-bottom: 1px solid #e9ecef; }
        .detail-header h5 { font-weight: 600; }
        .status-badge { display: inline-block; margin-top: 4px; padding: 2px 10px; border-radius: 10px; font-size: 0.72rem; background: #e2e3e5; color: #41464b; }
        .status-badge.on { background: #d1e7dd; color: #0f5132; }
        .detail-body { padding: 16px 20px; overflow-y: auto; flex: 1; }
        .detail-body .desc { color: #495057; margin-bottom: 16px; }
        .field { display: flex; justify-content: space-between; gap: 16px; padding: 8px 0; border-bottom: 1px solid #f1f3f5; font-size: 0.875rem; }
        .field .k { color: #6c757d; }
        .field .v { font-weight: 500; text-align: right; }
        .field .v.mono { font-family: monospace; font-size: 0.8rem; word-break: break-all; }
        .field code { background: #eef; padding: 1px 6px; border-radius: 4px; }
        .section-label { font-weight: 600; font-size: 0.8rem; text-transform: uppercase; color: #6c757d; margin: 18px 0 8px; }
        .features { margin: 0; padding-left: 18px; font-size: 0.875rem; }
        .tiers-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
        .tiers-table th, .tiers-table td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #f1f3f5; }
        .tiers-table th { color: #6c757d; font-weight: 600; }
        .link-cell { min-width: 160px; }
        .gen-btn { font-size: 0.75rem; line-height: 1.6; min-height: 30px; padding: 0 10px; }
        .btn-inner { display: inline-flex; align-items: center; }
        .link-row { display: flex; align-items: center; gap: 2px; }
        .link-input { width: 110px; font-size: 0.72rem; font-family: monospace; border: 1px solid #e9ecef; border-radius: 4px; padding: 3px 6px; background: #f8f9fa; }
        .detail-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px; border-top: 1px solid #e9ecef; }
    `],
})
export default class ProductsPageComponent extends BaseComponent implements OnInit {
    private fb = inject(FormBuilder);
    private functions = inject(Functions);
    store = inject(ProductsStore);

    @ViewChild('drawer') drawer!: MatDrawer;

    columns = ['name', 'type', 'premiumType', 'purchaseCount', 'active', 'actions'];
    showForm = signal(false);
    editingId = signal<string | null>(null);
    selected = signal<IProduct | null>(null);
    testLinks = signal<Record<number, string>>({});
    generatingTier = signal<number | null>(null);
    form!: FormGroup;

    get tiers(): FormArray {
        return this.form.get('tiers') as FormArray;
    }

    ngOnInit(): void {
        this.buildForm();
        this.store.getAll();
    }

    private buildForm(): void {
        this.form = this.fb.group({
            name: ['', Validators.required],
            dodoProductId: ['', Validators.required],
            description: [''],
            type: ['subscription', Validators.required],
            interval: ['month'],
            trialDays: [0],
            updatesYears: [0],
            creditsGranted: [0],
            price: [0],
            currency: ['USD'],
            premiumType: ['', Validators.required],
            tierRank: [1, Validators.required],
            active: [true],
            tiers: this.fb.array([]),
        });
    }

    private tierGroup(t?: Partial<{ label: string; maxCount: number; discountCode: string; discountPct: number; price: number }>): FormGroup {
        return this.fb.group({
            label: [t?.label ?? ''],
            maxCount: [t?.maxCount ?? 0],
            discountCode: [t?.discountCode ?? ''],
            discountPct: [t?.discountPct ?? 0],
            price: [t?.price ?? 0],
        });
    }

    addTier(): void {
        this.tiers.push(this.tierGroup());
    }

    removeTier(i: number): void {
        this.tiers.removeAt(i);
    }

    /** Open the right-side detail panel for a product. */
    viewProduct(p: IProduct): void {
        this.selected.set(p);
        this.testLinks.set({});
        this.generatingTier.set(null);
        this.drawer.open();
    }

    closeDetail(): void {
        this.drawer.close();
        this.selected.set(null);
        this.testLinks.set({});
    }

    /** Generate a Dodo checkout link applying a specific tier's discount code. */
    async generateTestLink(p: IProduct, tierIndex: number, discountCode: string): Promise<void> {
        if (this.generatingTier() !== null) return;
        this.generatingTier.set(tierIndex);
        try {
            const callable = httpsCallable(this.functions, 'createTestCheckoutLink');
            const result = await callable({ productId: p.id, discountCode: discountCode || '' });
            const url = (result.data as { checkoutUrl?: string }).checkoutUrl;
            if (url) {
                this.testLinks.update((m) => ({ ...m, [tierIndex]: url }));
            } else {
                this.toastService.error('No checkout URL returned.');
            }
        } catch (e) {
            console.error('generateTestLink failed', e);
            this.toastService.error('Could not generate link. Check that Dodo Payments is enabled and configured.');
        } finally {
            this.generatingTier.set(null);
        }
    }

    async copyLink(url: string): Promise<void> {
        try {
            await navigator.clipboard.writeText(url);
            this.toastService.success('Link copied to clipboard.');
        } catch {
            this.toastService.error('Copy failed — select the text and copy manually.');
        }
    }

    selectAll(event: Event): void {
        (event.target as HTMLInputElement)?.select();
    }

    /** Jump from the detail panel into the edit form. */
    editFromDetail(p: IProduct): void {
        this.closeDetail();
        this.editProduct(p);
    }

    openCreate(): void {
        this.editingId.set(null);
        this.buildForm();
        this.showForm.set(true);
    }

    editProduct(p: IProduct): void {
        this.editingId.set(p.id);
        this.buildForm();
        this.form.patchValue({
            name: p.name, dodoProductId: p.providerProductIds?.dodo ?? '', description: p.description ?? '',
            type: p.type, interval: p.interval ?? 'month', trialDays: p.trialDays ?? 0,
            updatesYears: p.updatesYears ?? 0,
            creditsGranted: p.creditsGranted ?? 0,
            price: p.price ?? 0, currency: p.currency ?? 'USD',
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
            providerProductIds: { dodo: v.dodoProductId },
            description: v.description,
            type: v.type,
            interval: v.type === 'subscription' ? v.interval : undefined,
            trialDays: v.type === 'subscription' ? Number(v.trialDays) || 0 : 0,
            updatesYears: v.type === 'one_time' ? Number(v.updatesYears) || 0 : 0,
            creditsGranted: Number(v.creditsGranted) || 0,
            price: Number(v.price) || 0,
            currency: v.currency || 'USD',
            premiumType: v.premiumType,
            tierRank: Number(v.tierRank) || 0,
            active: v.active,
            tiers: (v.tiers ?? []).map((t: { label: string; maxCount: number; discountCode: string; discountPct: number; price: number }) => ({
                label: t.label, maxCount: Number(t.maxCount) || 0, discountCode: t.discountCode, discountPct: Number(t.discountPct) || 0, price: Number(t.price) || 0,
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
                next: () => { this.toastService.success('Product created.'); this.closeForm(); this.store.getAll(); },
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
