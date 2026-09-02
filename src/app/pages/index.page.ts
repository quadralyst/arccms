import { RouteMeta } from '@analogjs/router';
import { AfterViewInit, Component, ElementRef, inject, OnDestroy, PLATFORM_ID, ViewEncapsulation } from '@angular/core';
import { isPlatformBrowser, NgOptimizedImage } from '@angular/common';
import { Router } from '@angular/router';
import { take } from 'rxjs';
import { BaseComponent } from '../../shared/components/base/base.component';
import { HeaderComponent } from './page.parts/header.component';
import { FooterComponent } from './page.parts/footer.component';
import { ContentPartialsComponent } from './page.parts/content-partials.component';
import { WaitlistFormService } from './page.parts/waitlist-form.service';
import { AuthService } from './(auth)/auth.service';
import { OnboardingSetupService } from './(onboarding)/onboarding-setup.service';

export const routeMeta: RouteMeta = {
  title: 'Home | Arc CMS',
};

@Component({
  selector: 'arc-home',
  standalone: true,
  templateUrl: '../../../public/index.html',
  styleUrl: '../../../public/assets/css/main.css',
  encapsulation: ViewEncapsulation.None,
  imports: [HeaderComponent, FooterComponent, ContentPartialsComponent, NgOptimizedImage],
})
export default class HomeComponent extends BaseComponent implements AfterViewInit, OnDestroy {
  private elementRef = inject(ElementRef);
  private waitlistFormService = inject(WaitlistFormService);
  private authService = inject(AuthService);
  private setupService = inject(OnboardingSetupService);
  private homeRouter = inject(Router);

  private platformId = inject(PLATFORM_ID);

  private observer?: MutationObserver;
  private resizeHandler?: () => void;
  private clickHandler?: (e: Event) => void;

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    this.initSliders();

    // Debug mode: bypass onboarding redirect for deployment verification
    if (new URLSearchParams(window.location.search).has('debug')) {
      this.waitlistFormService.initWaitlistForms(this.elementRef.nativeElement, 'index.html');
      return;
    }

    // On first run (no users yet), redirect to the onboarding wizard
    this.authService.isFirstRun().pipe(take(1)).subscribe((firstRun) => {
      if (firstRun) {
        this.homeRouter.navigate(['/onboarding']);
        return;
      }
      // Also redirect if onboarding wizard was started but not completed
      this.setupService.isOnboardingComplete().pipe(take(1)).subscribe((complete) => {
        if (!complete) {
          this.homeRouter.navigate(['/onboarding']);
          return;
        }
        this.waitlistFormService.initWaitlistForms(this.elementRef.nativeElement, 'index.html');
      });
    });
  }

  private initSliders(): void {
    const host = this.elementRef.nativeElement as HTMLElement;

    // Scan for any loopable tracks already in the DOM
    this.scanAndSetupTracks(host);

    // Watch for dynamically hydrated tracks (e.g. from <arc-content-partials>)
    this.observer = new MutationObserver(() => {
      this.scanAndSetupTracks(host);
    });
    this.observer.observe(host, { childList: true, subtree: true });

    // Unified click delegation for all [data-carousel] components
    this.clickHandler = (e: Event) => {
      const btn = (e.target as HTMLElement).closest('[data-carousel-prev], [data-carousel-next]') as HTMLElement | null;
      if (!btn) return;
      const isPrev = btn.hasAttribute('data-carousel-prev');
      this.handleCarouselClick(btn, isPrev);
    };
    host.addEventListener('click', this.clickHandler);

    // Handle window resize realignment
    let resizeTimer: ReturnType<typeof setTimeout>;
    this.resizeHandler = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const loopTracks = host.querySelectorAll<HTMLElement>('[data-carousel-track][data-loop-initialized="true"]');
        loopTracks.forEach((track) => {
          const currentIndex = parseInt(track.dataset['currentIndex'] || '1', 10);
          const step = this.getSlideStep(track);
          track.style.scrollBehavior = 'auto';
          track.style.scrollSnapType = 'none';
          track.scrollLeft = currentIndex * step;
          requestAnimationFrame(() => {
            track.style.scrollBehavior = '';
            track.style.scrollSnapType = '';
          });
        });
      }, 100);
    };
    window.addEventListener('resize', this.resizeHandler);
  }

  private scanAndSetupTracks(host: HTMLElement): void {
    const loopCarousels = host.querySelectorAll<HTMLElement>('[data-carousel-loop], .voices[data-carousel]');
    loopCarousels.forEach((carousel) => {
      const track = carousel.querySelector<HTMLElement>('[data-carousel-track]');
      if (track && track.children.length > 1 && track.dataset['loopInitialized'] !== 'true') {
        this.setupLoopTrack(track);
      }
    });
  }

  private getSlideStep(track: HTMLElement): number {
    const first = track.firstElementChild as HTMLElement | null;
    if (!first) return track.clientWidth || 300;
    const style = window.getComputedStyle(track);
    const gap = parseFloat(style.columnGap || style.gap || '0') || 0;
    return first.offsetWidth + gap;
  }

  private setupLoopTrack(track: HTMLElement): void {
    if (!track || track.dataset['loopInitialized'] === 'true') return;

    // Filter out existing clones if any
    const originalSlides = Array.from(track.children).filter(
      (el) => !el.hasAttribute('data-carousel-clone')
    ) as HTMLElement[];

    // If there's only 0 or 1 item, no infinite loop needed
    if (originalSlides.length <= 1) return;

    // Clone first and last items for seamless infinite illusion
    const firstClone = originalSlides[0].cloneNode(true) as HTMLElement;
    firstClone.setAttribute('data-carousel-clone', 'first');
    firstClone.setAttribute('aria-hidden', 'true');

    const lastClone = originalSlides[originalSlides.length - 1].cloneNode(true) as HTMLElement;
    lastClone.setAttribute('data-carousel-clone', 'last');
    lastClone.setAttribute('aria-hidden', 'true');

    // Prepend clone of last item and append clone of first item
    track.insertBefore(lastClone, originalSlides[0]);
    track.appendChild(firstClone);

    track.dataset['loopInitialized'] = 'true';
    track.dataset['originalCount'] = String(originalSlides.length);
    track.dataset['currentIndex'] = '1';

    // Position track at index 1 (the first real slide) without visual scrolling
    requestAnimationFrame(() => {
      const step = this.getSlideStep(track);
      track.style.scrollBehavior = 'auto';
      track.style.scrollSnapType = 'none';
      track.scrollLeft = step;
      requestAnimationFrame(() => {
        track.style.scrollBehavior = '';
        track.style.scrollSnapType = '';
      });
    });

    // Handle manual swipe/drag scroll synchronization
    const handleScrollEnd = () => {
      if (track.dataset['isAnimating'] === 'true') return;
      const step = this.getSlideStep(track);
      if (step <= 0) return;
      const originalCount = parseInt(track.dataset['originalCount'] || '1', 10);
      const currentIdx = Math.round(track.scrollLeft / step);

      if (currentIdx === 0) {
        // Scrolled to prepended clone of last item -> silently jump to original last item
        track.style.scrollBehavior = 'auto';
        track.style.scrollSnapType = 'none';
        track.scrollLeft = originalCount * step;
        track.dataset['currentIndex'] = String(originalCount);
        requestAnimationFrame(() => {
          track.style.scrollBehavior = '';
          track.style.scrollSnapType = '';
        });
      } else if (currentIdx === originalCount + 1) {
        // Scrolled to appended clone of first item -> silently jump to original first item
        track.style.scrollBehavior = 'auto';
        track.style.scrollSnapType = 'none';
        track.scrollLeft = 1 * step;
        track.dataset['currentIndex'] = '1';
        requestAnimationFrame(() => {
          track.style.scrollBehavior = '';
          track.style.scrollSnapType = '';
        });
      } else if (currentIdx >= 1 && currentIdx <= originalCount) {
        track.dataset['currentIndex'] = String(currentIdx);
      }
    };

    track.addEventListener('scrollend', handleScrollEnd);

    let scrollTimeout: ReturnType<typeof setTimeout>;
    track.addEventListener('scroll', () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(handleScrollEnd, 150);
    }, { passive: true });
  }

  private handleCarouselClick(btn: HTMLElement, isPrev: boolean): void {
    const carousel = btn.closest('[data-carousel]') as HTMLElement | null;
    const track = carousel?.querySelector('[data-carousel-track]') as HTMLElement | null;
    if (!track) return;

    // Check if this carousel is set up for infinite looping (e.g. Voices of Impact)
    if (carousel?.hasAttribute('data-carousel-loop') || carousel?.classList.contains('voices')) {
      if (track.dataset['loopInitialized'] !== 'true') {
        this.setupLoopTrack(track);
      }

      if (track.dataset['loopInitialized'] === 'true') {
        if (track.dataset['isAnimating'] === 'true') return;
        track.dataset['isAnimating'] = 'true';

        const originalCount = parseInt(track.dataset['originalCount'] || '1', 10);
        let currentIndex = parseInt(track.dataset['currentIndex'] || '1', 10);
        const step = this.getSlideStep(track);

        if (isPrev) {
          currentIndex--;
          track.dataset['currentIndex'] = String(currentIndex);
          track.scrollTo({ left: currentIndex * step, behavior: 'smooth' });

          if (currentIndex === 0) {
            // Reached prepended clone of the last item -> smoothly animate there, then silently jump to original last item
            setTimeout(() => {
              track.style.scrollBehavior = 'auto';
              track.style.scrollSnapType = 'none';
              track.scrollLeft = originalCount * step;
              track.dataset['currentIndex'] = String(originalCount);
              requestAnimationFrame(() => {
                track.style.scrollBehavior = '';
                track.style.scrollSnapType = '';
                track.dataset['isAnimating'] = 'false';
              });
            }, 350);
          } else {
            setTimeout(() => {
              track.dataset['isAnimating'] = 'false';
            }, 350);
          }
        } else {
          // Next
          currentIndex++;
          track.dataset['currentIndex'] = String(currentIndex);
          track.scrollTo({ left: currentIndex * step, behavior: 'smooth' });

          if (currentIndex === originalCount + 1) {
            // Reached appended clone of the first item -> smoothly animate there, then silently jump to original first item
            setTimeout(() => {
              track.style.scrollBehavior = 'auto';
              track.style.scrollSnapType = 'none';
              track.scrollLeft = 1 * step;
              track.dataset['currentIndex'] = '1';
              requestAnimationFrame(() => {
                track.style.scrollBehavior = '';
                track.style.scrollSnapType = '';
                track.dataset['isAnimating'] = 'false';
              });
            }, 350);
          } else {
            setTimeout(() => {
              track.dataset['isAnimating'] = 'false';
            }, 350);
          }
        }
        return;
      }
    }

    // Default wrap-around behavior for multi-item carousels (e.g., Personas)
    const firstChild = track.firstElementChild as HTMLElement | null;
    const style = window.getComputedStyle(track);
    const gap = parseFloat(style.columnGap || style.gap || '16') || 16;
    const step = firstChild ? (firstChild.offsetWidth + gap) : (track.clientWidth * 0.8);
    const maxScroll = track.scrollWidth - track.clientWidth;

    if (isPrev) {
      if (track.scrollLeft <= 10) {
        track.scrollTo({ left: maxScroll, behavior: 'smooth' });
      } else {
        track.scrollBy({ left: -step, behavior: 'smooth' });
      }
    } else {
      if (track.scrollLeft >= maxScroll - 10) {
        track.scrollTo({ left: 0, behavior: 'smooth' });
      } else {
        track.scrollBy({ left: step, behavior: 'smooth' });
      }
    }
  }

  ngOnDestroy(): void {
    this.waitlistFormService.cleanup();
    if (this.observer) {
      this.observer.disconnect();
    }
    if (this.resizeHandler && typeof window !== 'undefined') {
      window.removeEventListener('resize', this.resizeHandler);
    }
    if (this.clickHandler) {
      const host = this.elementRef.nativeElement as HTMLElement;
      host.removeEventListener('click', this.clickHandler);
    }
  }
}
