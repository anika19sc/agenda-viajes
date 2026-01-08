import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RevenuePage } from './revenue.page';

describe('RevenuePage', () => {
  let component: RevenuePage;
  let fixture: ComponentFixture<RevenuePage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(RevenuePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
