import { computed } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { DESTINATIONS, type Destination, type Region } from './destination';

export type SortOrder = 'popular' | 'price' | 'rating';

export interface Booking {
  id: string;
  destinationId: string;
  destinationName: string;
  startDate: string;
  travelers: number;
  name: string;
  email: string;
  requests?: string;
  total: number;
}

interface TravelState {
  destinations: Destination[];
  query: string;
  region: Region | 'All';
  sort: SortOrder;
  saved: string[];
  bookings: Booking[];
  nextBookingNumber: number;
}

const initialState: TravelState = {
  destinations: DESTINATIONS,
  query: '',
  region: 'All',
  sort: 'popular',
  saved: [],
  bookings: [],
  nextBookingNumber: 1041,
};

export const TravelStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(({ destinations, query, region, sort, saved, bookings }) => ({
    results: computed(() => {
      const text = query().trim().toLowerCase();
      const list = destinations().filter(
        (d) =>
          (region() === 'All' || d.region === region()) &&
          (!text || `${d.name} ${d.country} ${d.summary}`.toLowerCase().includes(text)),
      );
      const order: Record<SortOrder, (a: Destination, b: Destination) => number> = {
        popular: (a, b) => b.reviews - a.reviews,
        price: (a, b) => a.price - b.price,
        rating: (a, b) => b.rating - a.rating,
      };
      return [...list].sort(order[sort()]);
    }),
    regions: computed(() => [...new Set(destinations().map((d) => d.region))]),
    savedDestinations: computed(() => destinations().filter((d) => saved().includes(d.id))),
    savedCount: computed(() => saved().length),
    upcomingTrips: computed(() =>
      [...bookings()].sort((a, b) => a.startDate.localeCompare(b.startDate)),
    ),
  })),
  withMethods((store) => ({
    setQuery(query: string): void {
      patchState(store, { query });
    },
    setRegion(region: Region | 'All'): void {
      patchState(store, { region });
    },
    setSort(sort: SortOrder): void {
      patchState(store, { sort });
    },
    isSaved(id: string): boolean {
      return store.saved().includes(id);
    },
    toggleSaved(id: string): void {
      patchState(store, (state) => ({
        saved: state.saved.includes(id)
          ? state.saved.filter((saved) => saved !== id)
          : [...state.saved, id],
      }));
    },
    book(booking: Omit<Booking, 'id'>): Booking | null {
      const destination = store.destinations().find((d) => d.id === booking.destinationId);
      if (!destination || booking.travelers < 1 || booking.travelers > destination.seats) {
        return null;
      }
      const created = { ...booking, id: `TRV-${store.nextBookingNumber()}` };
      patchState(store, (state) => ({
        nextBookingNumber: state.nextBookingNumber + 1,
        bookings: [...state.bookings, created],
        destinations: state.destinations.map((d) =>
          d.id === booking.destinationId ? { ...d, seats: d.seats - booking.travelers } : d,
        ),
      }));
      return created;
    },
    cancel(bookingId: string): void {
      const booking = store.bookings().find((b) => b.id === bookingId);
      if (!booking) return;
      patchState(store, (state) => ({
        bookings: state.bookings.filter((b) => b.id !== bookingId),
        destinations: state.destinations.map((d) =>
          d.id === booking.destinationId ? { ...d, seats: d.seats + booking.travelers } : d,
        ),
      }));
    },
  })),
);
