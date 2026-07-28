import { defineConfig } from 'tsup';

// Dual ESM/CJS + .d.ts so all three consumers resolve cleanly:
// Node (API, tsx), Vite (admin), and Metro (mobile, package-exports aware on SDK 57).
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  treeshake: true,
});
