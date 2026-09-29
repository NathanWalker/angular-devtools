import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: [
    'src/devframe.ts',
    'src/popup.ts',
    'src/overlay.ts',
    'src/overlay-nativescript.ts',
    'src/vite.ts',
    'src/http.ts',
    'src/hub.ts',
  ],
  external: [/^@angular\//, /^@nativescript\//, /^rxjs/],
  format: 'esm',
  platform: 'node',
  dts: true,
});
