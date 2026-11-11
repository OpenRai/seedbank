import type { LookupOptions } from './e2e/fixtures';
import { defineConfig } from '@playwright/test';
export default defineConfig<LookupOptions>({
 projects: ['proxy', 'nano-rpc', 'json-rpc'].map(name => ({ name, use: { lookupMode: name as LookupOptions['lookupMode'] } })),
 testDir: './e2e', retries: 0, fullyParallel: true,
 timeout: 60_000,
 expect: { timeout: 10_000 },
 use: { baseURL: 'http://127.0.0.1:49173', browserName: 'chromium', serviceWorkers: 'block', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
 reporter: [['list'], ['html', {open:'never'}]],
 webServer: {command:'npm run test:e2e:serve', url:'http://127.0.0.1:49173', reuseExistingServer:false},
});
