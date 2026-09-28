import { inject } from '@angular/core';
import { RedirectCommand, Router, type CanDeactivateFn, type ResolveFn } from '@angular/router';
import type { Destination } from './destination';
import { TravelStore } from './travel.store';

export const destinationResolver: ResolveFn<Destination> = (route) => {
  const found = inject(TravelStore)
    .destinations()
    .find((d) => d.id === route.paramMap.get('id'));
  if (found) return found;
  return new RedirectCommand(inject(Router).parseUrl('/destinations'));
};

export const destinationTitle: ResolveFn<string> = (route) => {
  const found = inject(TravelStore)
    .destinations()
    .find((d) => d.id === route.paramMap.get('id'));
  return `${found?.name ?? 'Trip'} · Angular Travel`;
};

export interface LeavesSafely {
  canLeave(): boolean;
}

export const confirmLeaveGuard: CanDeactivateFn<LeavesSafely> = (page) =>
  page.canLeave() || confirm('Leave this booking? The details you entered will be lost.');
