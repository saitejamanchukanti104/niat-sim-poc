import { build } from 'esbuild';

await build({
  entryPoints: ['web/src/app.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  outfile: 'web/public/app.js',
  logLevel: 'info',
});
