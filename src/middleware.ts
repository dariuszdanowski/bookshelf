import { defineMiddleware } from 'astro:middleware';

import { handleRequest } from './lib/middleware/handler';

/**
 * Astro entrypoint — thin wrapper z `defineMiddleware` (TypeScript narrow
 * dla handler signature). Cała logika w `lib/middleware/handler.ts`,
 * testowalna w izolacji bez `astro:middleware` virtual module.
 */
export const onRequest = defineMiddleware(handleRequest);
