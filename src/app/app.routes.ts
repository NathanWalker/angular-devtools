import { Routes } from '@angular/router';
import { signedInGuard } from './travel/auth';
import { confirmLeaveGuard, destinationResolver, destinationTitle } from './travel/trip-routes';

export const routes: Routes = [
  {
    path: '',
    title: 'Angular Travel',
    loadComponent: () => import('./pages/home').then((m) => m.Home),
  },
  {
    path: 'destinations',
    title: 'Destinations · Angular Travel',
    loadComponent: () => import('./pages/destinations').then((m) => m.Destinations),
  },
  {
    path: 'destinations/:id',
    title: destinationTitle,
    loadComponent: () => import('./pages/destination-detail').then((m) => m.DestinationDetail),
    resolve: { destination: destinationResolver },
  },
  {
    path: 'book/:id',
    title: 'Book your trip · Angular Travel',
    loadComponent: () => import('./pages/booking').then((m) => m.Booking),
    resolve: { destination: destinationResolver },
    canDeactivate: [confirmLeaveGuard],
  },
  {
    path: 'trips',
    title: 'My trips · Angular Travel',
    canActivate: [signedInGuard],
    loadComponent: () => import('./pages/trips').then((m) => m.Trips),
  },
  {
    path: 'sign-in',
    title: 'Sign in · Angular Travel',
    loadComponent: () => import('./pages/sign-in').then((m) => m.SignIn),
  },
  {
    path: 'about',
    title: 'About · Angular Travel',
    loadComponent: () => import('./pages/about').then((m) => m.About),
  },
  {
    path: 'examples',
    loadComponent: () => import('./examples/examples').then((m) => m.Examples),
    data: { title: 'DevTools examples' },
    loadChildren: () => import('./examples/examples.routes').then((m) => m.examplesRoutes),
  },
  { path: 'products', redirectTo: 'destinations' },
  { path: '**', redirectTo: '' },
];
