import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('dist/server', { recursive: true });
await build({ entryPoints: ['server/index.ts'], outfile: 'dist/server/index.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true });
await writeFile('dist/server/wrangler.json', JSON.stringify({ name: 'tyaga', main: 'index.js', compatibility_date: '2025-09-27', assets: { directory: '../client', binding: 'ASSETS', not_found_handling: 'single-page-application', run_worker_first: ['/api/*'] }, d1_databases: [{ binding: 'DB', database_name: 'tyaga', database_id: 'local-tyaga', migrations_dir: '../../drizzle' }] }, null, 2));
