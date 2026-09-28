import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-about',
  imports: [RouterLink],
  template: `
    <div class="container page">
      <p class="eyebrow">About this demo</p>
      <h1>A real-looking app to inspect</h1>
      <p class="lead">
        Angular Travel is the playground for the devtools. Open them with the amber button in the
        corner, then try these:
      </p>
      <ul class="tries">
        <li>
          <h2><a routerLink="/destinations">Destinations</a></h2>
          <p>
            Filter and sort, then watch the <strong>NgRx</strong> dock: the whole list lives in a
            signal store. The <strong>Signals</strong> tab shows the computed results update.
          </p>
        </li>
        <li>
          <h2><a routerLink="/destinations/kyoto">A trip page</a></h2>
          <p>
            Loaded by a resolver that redirects unknown trips. The <strong>Routes</strong> tab
            explains the navigation, including the resolver and the redirect.
          </p>
        </li>
        <li>
          <h2><a routerLink="/book/lisbon">Booking</a></h2>
          <p>
            A Signal Forms checkout with a seat limit and an unsaved-changes guard. The
            <strong>Forms</strong> tab shows every field, its errors and why submit is blocked.
          </p>
        </li>
        <li>
          <h2><a routerLink="/trips">My Trips</a></h2>
          <p>
            Behind a sign-in guard that sends you to a reactive form and back. Great for the
            navigation timeline.
          </p>
        </li>
        <li>
          <h2><a routerLink="/examples">DevTools Lab</a></h2>
          <p>
            Small, focused examples for components, DI, routes, signals and all three form APIs.
          </p>
        </li>
      </ul>
    </div>
  `,
  styles: `
    .page {
      max-width: 860px;
      padding-top: 40px;
      padding-bottom: 72px;
    }
    h1 {
      margin: 0 0 12px;
      font-size: clamp(28px, 4vw, 40px);
      line-height: 1.15;
      letter-spacing: -0.02em;
    }
    .lead {
      max-width: 60ch;
      margin: 0 0 32px;
      color: var(--muted);
      font-size: 17px;
    }
    .tries {
      display: grid;
      gap: 12px;
      margin: 0;
      padding: 0;
      list-style: none;
      counter-reset: try;
    }
    .tries li {
      position: relative;
      display: grid;
      grid-template-columns: 32px minmax(0, 1fr) 20px;
      column-gap: 16px;
      padding: 20px;
      border: 1px solid var(--line);
      border-radius: var(--radius, 12px);
      background: var(--surface);
      box-shadow: var(--shadow-sm);
      counter-increment: try;
      transition:
        border-color 0.15s var(--ease, ease),
        box-shadow 0.15s var(--ease, ease),
        transform 0.15s var(--ease, ease);
    }
    .tries li::before {
      content: counter(try);
      grid-row: 1 / span 2;
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: var(--brand-soft);
      color: var(--brand-strong);
      font-size: 14px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .tries li::after {
      content: '';
      grid-column: 3;
      grid-row: 1 / span 2;
      align-self: center;
      width: 20px;
      height: 20px;
      background: var(--muted);
      mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m9 18 6-6-6-6'/%3E%3C/svg%3E")
        center / contain no-repeat;
      transition:
        transform 0.15s var(--ease, ease),
        background-color 0.15s var(--ease, ease);
    }
    .tries li:hover {
      border-color: var(--line-strong);
      box-shadow: 0 4px 16px var(--shadow);
    }
    .tries li:hover::after {
      background: var(--brand);
      transform: translateX(2px);
    }
    .tries li:has(a:focus-visible) {
      outline: 2px solid var(--brand);
      outline-offset: 2px;
    }
    h2 {
      margin: 4px 0;
      font-size: 17px;
      line-height: 1.3;
    }
    h2 a {
      color: var(--ink);
      text-decoration: none;
    }
    h2 a::after {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: inherit;
    }
    h2 a:focus-visible {
      outline: none;
    }
    .tries li:hover h2 a {
      color: var(--brand);
    }
    .tries p {
      grid-column: 2;
      margin: 0;
      color: var(--muted);
    }
    strong {
      color: var(--ink);
      font-weight: 600;
    }
    @media (max-width: 480px) {
      .tries li {
        grid-template-columns: 28px minmax(0, 1fr);
        column-gap: 12px;
        padding: 16px;
      }
      .tries li::before {
        width: 28px;
        height: 28px;
        font-size: 13px;
      }
      .tries li::after {
        display: none;
      }
    }
  `,
})
export class About {}
