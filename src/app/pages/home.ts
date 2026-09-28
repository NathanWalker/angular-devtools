import { NgOptimizedImage } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DestinationCard } from '../travel/destination-card';
import { TravelStore } from '../travel/travel.store';

@Component({
  selector: 'app-home',
  imports: [NgOptimizedImage, RouterLink, DestinationCard],
  template: `
    <section class="hero">
      <img
        class="hero-photo"
        ngSrc="/destinations/istanbul.webp"
        width="1400"
        height="875"
        alt=""
        priority
      />
      <div class="hero-inner container">
        <p class="eyebrow">Small group trips · {{ store.destinations().length }} destinations</p>
        <h1>Trips planned around how you like to travel</h1>
        <p class="lead">
          Hand-picked stays, local guides and routes that leave room for slow mornings.
        </p>
        <form class="search" role="search" (submit)="search($event)">
          <label for="hero-search" class="sr-only">Where do you want to go?</label>
          <svg
            class="search-icon"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            #searchInput
            id="hero-search"
            name="q"
            type="search"
            autocomplete="off"
            placeholder="Try “Istanbul” or “mountains”…"
            [value]="query()"
            (input)="query.set(searchInput.value)"
          />
          <button type="submit" class="btn btn-primary">Find Trips</button>
        </form>
      </div>
    </section>

    <section class="container section" aria-labelledby="featured-title">
      <div class="section-head">
        <div>
          <p class="eyebrow">Popular this season</p>
          <h2 id="featured-title">Featured destinations</h2>
        </div>
        <a class="btn" routerLink="/destinations">View all {{ store.destinations().length }}</a>
      </div>
      <div class="grid">
        @for (destination of featured(); track destination.id; let first = $first) {
          <app-destination-card [destination]="destination" [priority]="first" />
        }
      </div>
    </section>

    <section class="container section steps" aria-labelledby="how-title">
      <h2 id="how-title">How it works</h2>
      <ol>
        <li>
          <span class="num" aria-hidden="true">1</span>
          <h3>Pick a trip</h3>
          <p>Every route is walked by our team first, so the days are paced for real people.</p>
        </li>
        <li>
          <span class="num" aria-hidden="true">2</span>
          <h3>Book in two minutes</h3>
          <p>Choose a date and how many are coming. Change it for free up to 30 days before.</p>
        </li>
        <li>
          <span class="num" aria-hidden="true">3</span>
          <h3>Just show up</h3>
          <p>Transfers, stays and tickets are in the app, with a local host on call.</p>
        </li>
      </ol>
    </section>
  `,
  styles: `
    .hero {
      position: relative;
      display: grid;
      align-items: end;
      min-height: min(78vh, 640px);
      overflow: hidden;
      background: #0c0c10;
      color: #fff;
    }
    .hero-photo {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .hero::after {
      content: '';
      position: absolute;
      inset: 0;
      background:
        linear-gradient(
          90deg,
          rgba(12, 12, 16, 0.8) 0%,
          rgba(12, 12, 16, 0.5) 45%,
          rgba(12, 12, 16, 0.05) 80%
        ),
        linear-gradient(180deg, rgba(12, 12, 16, 0) 40%, rgba(12, 12, 16, 0.75) 100%);
    }
    .hero-inner {
      position: relative;
      z-index: 1;
      padding-top: 96px;
      padding-bottom: 56px;
      animation: rise 0.6s var(--ease) both;
    }
    @keyframes rise {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
    }
    .hero .eyebrow {
      margin-bottom: 12px;
      color: var(--accent);
      font-variant-numeric: tabular-nums;
    }
    h1 {
      max-width: 16ch;
      margin: 0 0 16px;
      font-size: clamp(34px, 5.5vw, 60px);
      line-height: 1.05;
      letter-spacing: -0.03em;
    }
    .lead {
      max-width: 52ch;
      margin: 0 0 32px;
      color: rgba(255, 255, 255, 0.88);
      font-size: 18px;
      line-height: 1.5;
      text-wrap: pretty;
    }
    .search {
      position: relative;
      display: flex;
      align-items: center;
      gap: 8px;
      max-width: 560px;
      padding: 6px;
      border-radius: 14px;
      background: var(--surface);
      color: var(--ink);
      box-shadow: 0 24px 48px -20px rgba(0, 0, 0, 0.6);
    }
    .search-icon {
      position: absolute;
      top: 50%;
      left: 18px;
      color: var(--muted);
      transform: translateY(-50%);
      pointer-events: none;
    }
    .search input {
      flex: 1;
      min-width: 0;
      min-height: var(--control-h);
      padding: 0 12px 0 38px;
      border: none;
      background: transparent;
      color: var(--ink);
      font-size: 16px;
    }
    .search input::placeholder {
      color: var(--muted);
      opacity: 1;
    }
    .search input:focus-visible {
      outline: none;
    }
    .search:focus-within {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .section {
      padding-top: 72px;
    }
    .section-head {
      display: flex;
      justify-content: space-between;
      align-items: end;
      gap: 16px;
      margin-bottom: 24px;
    }
    .section-head .btn {
      flex: none;
      font-variant-numeric: tabular-nums;
    }
    h2 {
      margin: 0;
      font-size: clamp(24px, 3vw, 32px);
      line-height: 1.2;
      letter-spacing: -0.02em;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr));
      gap: 24px;
    }
    .steps {
      padding-bottom: 80px;
    }
    .steps ol {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
      gap: 16px;
      margin: 24px 0 0;
      padding: 0;
      list-style: none;
    }
    .steps li {
      padding: 24px;
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      background: var(--surface);
      box-shadow: var(--shadow-sm);
    }
    .num {
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      margin-bottom: 16px;
      border-radius: 50%;
      background: var(--brand-soft);
      color: var(--brand);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .steps h3 {
      margin: 0 0 8px;
      font-size: 17px;
      line-height: 1.3;
    }
    .steps p {
      margin: 0;
      color: var(--muted);
      text-wrap: pretty;
    }
    @media (max-width: 600px) {
      .hero-inner {
        padding-top: 72px;
        padding-bottom: 40px;
      }
      .lead {
        font-size: 16px;
      }
      .search {
        flex-direction: column;
        align-items: stretch;
      }
      .search-icon {
        top: 26px;
      }
      .search input {
        min-height: var(--control-h);
      }
      .section {
        padding-top: 56px;
      }
      .section-head {
        flex-direction: column;
        align-items: start;
      }
    }
  `,
})
export class Home {
  protected readonly store = inject(TravelStore);
  private readonly router = inject(Router);
  protected readonly query = signal('');
  protected readonly featured = computed(() =>
    [...this.store.destinations()].sort((a, b) => b.rating - a.rating).slice(0, 3),
  );

  protected search(event: Event) {
    event.preventDefault();
    const q = this.query().trim();
    void this.router.navigate(['/destinations'], { queryParams: q ? { q } : {} });
  }
}
