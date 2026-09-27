import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  imports: [RouterOutlet],
  template: `<section class="auth"><router-outlet /></section>`,
})
export default class AuthLayout {}
