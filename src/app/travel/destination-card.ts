import { CurrencyPipe, DecimalPipe, NgOptimizedImage } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Destination } from './destination';
import { TravelStore } from './travel.store';

@Component({
  selector: 'app-destination-card',
  imports: [RouterLink, NgOptimizedImage, CurrencyPipe, DecimalPipe],
  template: `
    <article class="card">
      <div class="photo">
        <img
          [ngSrc]="destination().image"
          width="1400"
          height="875"
          [alt]="destination().imageAlt"
          [priority]="priority()"
        />
        <button
          type="button"
          class="save"
          [class.on]="saved()"
          [attr.aria-pressed]="saved()"
          [attr.aria-label]="(saved() ? 'Remove ' : 'Save ') + destination().name"
          (click)="store.toggleSaved(destination().id)"
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
        </button>
        @if (!destination().seats) {
          <span class="tag sold">Fully Booked</span>
        } @else if (destination().seats <= 3) {
          <span class="tag low">{{ destination().seats }} seats left</span>
        }
      </div>
      <div class="body">
        <p class="where">
          <span class="country" translate="no">{{ destination().country }}</span>
          <span aria-hidden="true">·</span>
          <span class="nights">{{ destination().nights }} nights</span>
        </p>
        <h3>
          <a [routerLink]="['/destinations', destination().id]">{{ destination().name }}</a>
        </h3>
        <p class="summary">{{ destination().summary }}</p>
        <div class="meta">
          <span class="rating">
            <span class="star" aria-hidden="true">★</span>
            {{ destination().rating | number: '1.1-1' }}
            <span class="muted">({{ destination().reviews }})</span>
          </span>
          <span class="price">
            <span class="muted">from</span>
            {{ destination().price | currency: 'EUR' : 'symbol' : '1.0-0' }}
          </span>
        </div>
      </div>
    </article>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .card {
      position: relative;
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      background: var(--surface);
      box-shadow: var(--shadow-sm);
      transition:
        transform 0.2s var(--ease),
        box-shadow 0.2s var(--ease),
        border-color 0.2s var(--ease);
    }
    .card:hover {
      transform: translateY(-2px);
      border-color: var(--line-strong);
      box-shadow: 0 16px 32px -16px var(--shadow);
    }
    .card:has(h3 a:focus-visible) {
      outline: 2px solid var(--brand);
      outline-offset: 2px;
    }
    .photo {
      position: relative;
      aspect-ratio: 16 / 10;
      overflow: hidden;
      background: var(--subtle);
    }
    .photo img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
      transition: transform 0.4s var(--ease);
    }
    .card:hover .photo img {
      transform: scale(1.03);
    }
    .save {
      position: absolute;
      top: 12px;
      right: 12px;
      z-index: 2;
      display: grid;
      place-items: center;
      width: 36px;
      height: 36px;
      padding: 0;
      border: none;
      border-radius: 50%;
      background: rgba(12, 12, 16, 0.55);
      color: #fff;
      cursor: pointer;
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      transition:
        background-color 0.15s var(--ease),
        transform 0.15s var(--ease);
    }
    .save:hover {
      background: rgba(12, 12, 16, 0.75);
    }
    .save:active {
      transform: scale(0.92);
    }
    .save:focus-visible {
      outline: 2px solid #fff;
      outline-offset: 2px;
      box-shadow: 0 0 0 5px rgba(12, 12, 16, 0.6);
    }
    .save.on {
      background: var(--accent);
      color: var(--accent-ink);
    }
    .save.on:hover {
      background: var(--accent-strong);
    }
    .tag {
      position: absolute;
      left: 12px;
      bottom: 12px;
      padding: 4px 10px;
      border-radius: 99px;
      font-size: 12px;
      font-weight: 600;
      line-height: 1.3;
      font-variant-numeric: tabular-nums;
    }
    .tag.low {
      background: var(--accent);
      color: var(--accent-ink);
    }
    .tag.sold {
      background: rgba(12, 12, 16, 0.8);
      color: #fff;
    }
    .body {
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex: 1;
      padding: 16px;
    }
    .where {
      display: flex;
      gap: 6px;
      min-width: 0;
      margin: 0;
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .country {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .nights {
      flex: none;
      font-variant-numeric: tabular-nums;
    }
    h3 {
      margin: 0;
      font-size: 18px;
      line-height: 1.3;
      letter-spacing: -0.01em;
      overflow-wrap: anywhere;
    }
    h3 a {
      color: var(--ink);
      text-decoration: none;
    }
    h3 a::after {
      content: '';
      position: absolute;
      inset: 0;
    }
    h3 a:focus-visible {
      outline: none;
    }
    .card:hover h3 a {
      color: var(--brand);
    }
    .summary {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 3;
      line-clamp: 3;
      overflow: hidden;
      margin: 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.5;
      text-wrap: pretty;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: baseline;
      gap: 4px 12px;
      margin-top: auto;
      padding-top: 12px;
      border-top: 1px solid var(--line);
      font-size: 14px;
      font-variant-numeric: tabular-nums;
    }
    .rating {
      font-weight: 600;
    }
    .star {
      color: var(--brand);
    }
    .price {
      font-size: 16px;
      font-weight: 700;
    }
    .muted {
      color: var(--muted);
      font-size: 13px;
      font-weight: 400;
    }
    @media (prefers-reduced-motion: reduce) {
      .card,
      .photo img {
        transition: none;
      }
      .card:hover,
      .card:hover .photo img {
        transform: none;
      }
    }
  `,
})
export class DestinationCard {
  readonly destination = input.required<Destination>();
  readonly priority = input(false);
  protected readonly store = inject(TravelStore);
  protected readonly saved = computed(() => this.store.saved().includes(this.destination().id));
}
