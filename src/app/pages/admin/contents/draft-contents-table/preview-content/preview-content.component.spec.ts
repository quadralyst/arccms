import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PreviewContentComponent } from './preview-content.component';
import { By } from '@angular/platform-browser';
import { GlobalService } from '../../../../../../shared/services/global.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('PreviewContentComponent', () => {
  let component: PreviewContentComponent;
  let fixture: ComponentFixture<PreviewContentComponent>;
  let mockGlobalService: any;

  beforeEach(async () => {
    mockGlobalService = {
      convertMillisecondsToFormatDate: vi.fn().mockReturnValue('01 Jan 2023'),
      showCurrentYear: vi.fn()
    };

    await TestBed.configureTestingModule({
      imports: [PreviewContentComponent],
      providers: [
        { provide: GlobalService, useValue: mockGlobalService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(PreviewContentComponent);
    component = fixture.componentInstance;
    
    // Set required inputs
    fixture.componentRef.setInput('contentItem', {
      id: 'test-id',
      title: 'Test Title',
      publishedStatus: true,
      customFields: {
        'test-field': 'test-value'
      },
      createdAt: 1234567890,
      modifiedAt: 1234567890
    });
    
    fixture.componentRef.setInput('contentType', {
      id: 'type-id', 
      slug: 'test-type',
      name: 'Test Type',
      fields: [
        { key: 'test-field', label: 'Test Field', type: 'text' }
      ]
    } as any);

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should display title', () => {
    const titleEl = fixture.debugElement.query(By.css('.detail-row .fw-bold'));
    expect(titleEl.nativeElement.textContent).toContain('Test Title');
  });

  it('should display fields', () => {
    // Find label
    const labels = fixture.debugElement.queryAll(By.css('.detail-row label'));
    const fieldLabel = labels.find(el => el.nativeElement.textContent.includes('Test Field'));
    expect(fieldLabel).toBeTruthy();
    
    // Find value - need to look at all spans/divs in detail-row
    const values = fixture.debugElement.queryAll(By.css('.detail-row span'));
    const fieldValue = values.find(el => el.nativeElement.textContent.includes('test-value'));
    expect(fieldValue).toBeTruthy();
  });

  it('should emit close event on close button click', () => {
    const emitSpy = vi.spyOn(component.close, 'emit');
    const closeBtn = fixture.debugElement.query(By.css('.close-btn'));
    closeBtn.triggerEventHandler('click', null);
    expect(emitSpy).toHaveBeenCalled();
  });
});
