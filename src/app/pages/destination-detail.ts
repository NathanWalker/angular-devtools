import { CurrencyPipe, DecimalPipe, NgOptimizedImage } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Destination } from '../travel/destination';
import { TravelStore } from '../travel/travel.store';

@Component({
  selector: 'app-destination-detail',
  imports: [NgOptimizedImage, RouterLink, CurrencyPipe, DecimalPipe],
  template: `
    @let trip = live();
    <article>
      <header class="cover">
        <img [ngSrc]="trip.image" width="1400" height="875" [alt]="trip.imageAlt" priority />
        <div class="cover-inner container">
          <a class="back" routerLink="/destinations">
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M19 12H5M11 18l-6-6 6-6" />
            </svg>
            All destinations
          </a>
          <p class="eyebrow">
            <span translate="no">{{ trip.country }}</span> · {{ trip.region }}
          </p>
          <h1>{{ trip.name }}</h1>
          <p class="rating">
            <span class="star" aria-hidden="true">★</span>
            <strong>{{ trip.rating | number: '1.1-1' }}</strong>
            <span>from {{ trip.reviews | number }} reviews</span>
          </p>
        </div>
      </header>

      <div class="container layout">
        <div class="content">
          <p class="lead">{{ trip.description }}</p>
          <h2>Highlights</h2>
          <ul class="highlights">
            @for (item of trip.highlights; track item) {
              <li>{{ item }}</li>
            }
          </ul>
          <dl class="facts">
            <div>
              <dt>Length</dt>
              <dd>{{ trip.nights }} nights</dd>
            </div>
            <div>
              <dt>Best time</dt>
              <dd>{{ trip.bestTime }}</dd>
            </div>
            <div>
              <dt>Group size</dt>
              <dd>Up to {{ trip.groupSize }}</dd>
            </div>
          </dl>
        </div>

        <section class="booking" aria-label="Book this trip">
          <p class="from">From</p>
          <p class="price">
            {{ trip.price | currency: 'EUR' : 'symbol' : '1.0-0' }}
            <span>per person</span>
          </p>
          <p class="seats" [class.low]="trip.seats > 0 && trip.seats <= 3">
            {{ trip.seats ? trip.seats + ' seats left on the next departure' : 'Fully booked' }}
          </p>
          @if (trip.seats) {
            <a class="btn btn-primary wide" [routerLink]="['/book', trip.id]">Book This Trip</a>
          } @else {
            <button type="button" class="btn wide" disabled>Fully Booked</button>
          }
          <button
            type="button"
            class="btn wide save"
            [class.on]="saved()"
            [attr.aria-pressed]="saved()"
            (click)="store.toggleSaved(trip.id)"
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              stroke="currentColor"
              stroke-width="2"
              stroke-linejoin="round"
              [attr.fill]="saved() ? 'currentColor' : 'none'"
              aria-hidden="true"
            >
              <path
                d="M12 20.5s-7.5-4.6-7.5-10.1A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 7.5 2.8c0 5.5-7.5 10.1-7.5 10.1Z"
              />
            </svg>
            {{ saved() ? 'Saved' : 'Save for Later' }}
          </button>
          <p class="note">Free changes up to 30 days before departure.</p>
        </section>
      </div>
    </article>
  `,
  styles: `
    .cover {
      position: relative;
      display: grid;
      align-items: end;
      min-height: min(62vh, 520px);
      overflow: hidden;
      background: #0c0c10;
      color: #fff;
    }
    .cover img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .cover::after {
      content: '';
      position: absolute;
      inset: 0;
      background:
        linear-gradient(180deg, rgba(12, 12, 16, 0.45) 0%, rgba(12, 12, 16, 0) 28%),
        linear-gradient(180deg, rgba(12, 12, 16, 0) 35%, rgba(12, 12, 16, 0.88) 100%);
    }
    .cover-inner {
      position: relative;
      z-index: 1;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      min-height: inherit;
      padding-top: 24px;
      padding-bottom: 40px;
    }
    .back {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 34px;
      margin-bottom: auto;
      padding: 0 12px 0 10px;
      border-radius: 99px;
      background: rgba(12, 12, 16, 0.5);
      color: #fff;
      font-size: 14px;
      font-weight: 500;
      text-decoration: none;
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      transition: background-color 0.15s var(--ease);
    }
    .back:hover {
      background: rgba(12, 12, 16, 0.75);
    }
    .back:focus-visible {
      outline: 2px solid #fff;
      outline-offset: 2px;
    }
    .cover .eyebrow {
      margin-top: 48px;
      color: var(--accent);
    }
    h1 {
      margin: 0 0 12px;
      font-size: clamp(34px, 5vw, 56px);
      letter-spacing: -0.03em;
      line-height: 1.05;
      overflow-wrap: anywhere;
    }
    .rating {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 6px;
      margin: 0;
      color: rgba(255, 255, 255, 0.88);
      font-variant-numeric: tabular-nums;
    }
    .rating strong {
      color: #fff;
    }
    .star {
      color: var(--accent);
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 340px;
      gap: 48px;
      padding-top: 40px;
      padding-bottom: 80px;
    }
    .lead {
      max-width: 68ch;
      margin: 0 0 32px;
      font-size: 18px;
      line-height: 1.6;
      text-wrap: pretty;
    }
    h2 {
      margin: 0 0 12px;
      font-size: 20px;
      line-height: 1.3;
    }
    .highlights {
      display: grid;
      gap: 12px;
      margin: 0 0 32px;
      padding: 0;
      list-style: none;
    }
    .highlights li {
      display: flex;
      gap: 12px;
      align-items: flex-start;
    }
    .highlights li::before {
      content: '✓';
      display: grid;
      flex: none;
      place-items: center;
      width: 22px;
      height: 22px;
      margin-top: 1px;
      border-radius: 50%;
      background: var(--brand-soft);
      color: var(--brand);
      font-size: 12px;
      font-weight: 700;
    }
    .facts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(160px, 100%), 1fr));
      gap: 12px;
      margin: 0;
    }
    .facts div {
      padding: 16px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--surface);
    }
    dt {
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    dd {
      margin: 4px 0 0;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      text-wrap: pretty;
    }
    .booking {
      position: sticky;
      top: 88px;
      align-self: start;
      display: grid;
      gap: 12px;
      padding: 24px;
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      background: var(--surface);
      box-shadow: 0 16px 40px -24px var(--shadow);
    }
    .from {
      margin: 0 0 -8px;
      color: var(--muted);
      font-size: 13px;
    }
    .price {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 4px 8px;
      margin: 0;
      font-size: 32px;
      font-weight: 800;
      line-height: 1.2;
      letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums;
    }
    .price span {
      color: var(--muted);
      font-size: 14px;
      font-weight: 400;
      letter-spacing: 0;
    }
    .seats {
      margin: 0 0 4px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--line);
      color: var(--muted);
      font-size: 14px;
      font-variant-numeric: tabular-nums;
    }
    .seats.low {
      color: var(--brand);
      font-weight: 600;
    }
    .wide {
      width: 100%;
    }
    .save.on svg {
      color: var(--brand);
    }
    .note {
      margin: 4px 0 0;
      color: var(--muted);
      font-size: 13px;
      text-align: center;
      text-wrap: pretty;
    }
    @media (max-width: 860px) {
      .layout {
        grid-template-columns: 1fr;
        gap: 32px;
      }
      .booking {
        position: static;
      }
    }
    @media (max-width: 600px) {
      .cover-inner {
        padding-top: 16px;
        padding-bottom: 32px;
      }
      .layout {
        padding-top: 32px;
        padding-bottom: 64px;
      }
      .lead {
        font-size: 16px;
      }
      .booking {
        padding: 20px;
      }
    }
  `,
})
export class DestinationDetail {
  readonly destination = input.required<Destination>();
  protected readonly store = inject(TravelStore);
  protected readonly live = computed(
    () =>
      this.store.destinations().find((d) => d.id === this.destination().id) ?? this.destination(),
  );
  protected readonly saved = computed(() => this.store.saved().includes(this.destination().id));
}
