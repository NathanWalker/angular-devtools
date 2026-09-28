import { Service, computed, inject, signal } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';

@Service()
export class Account {
  readonly name = signal<string | null>(null);
  readonly email = signal<string | null>(null);
  readonly signedIn = computed(() => this.name() !== null);

  signIn(name: string, email: string) {
    this.name.set(name);
    this.email.set(email);
  }

  signOut() {
    this.name.set(null);
    this.email.set(null);
  }
}

export const signedInGuard: CanActivateFn = (_route, state) => {
  if (inject(Account).signedIn()) return true;
  return inject(Router).createUrlTree(['/sign-in'], { queryParams: { returnUrl: state.url } });
};
