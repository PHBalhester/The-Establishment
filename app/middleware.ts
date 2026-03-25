/**
 * middleware.ts -- Site Mode Toggle
 *
 * Controls which routes are accessible based on NEXT_PUBLIC_SITE_MODE env var:
 *
 * - "launch" (default): Lock entire site to /launch page only.
 *   During the bonding curve phase, users from X announcements see only
 *   the curve page -- clean UX, no distractions.
 *
 * - "live": Full site accessible. /launch remains available and shows
 *   a "graduated" historical state (handled by page.tsx).
 *
 * Toggle by changing the env var in Railway dashboard + redeploy.
 * No code deploy needed.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const siteMode = (process.env.NEXT_PUBLIC_SITE_MODE || 'launch').toLowerCase();
  const { pathname } = request.nextUrl;

  if (siteMode === 'launch') {
    // During bonding curve phase: redirect everything to /launch
    // The matcher config already excludes static assets, so we only
    // need to check for /launch itself (prevent redirect loop) and /api
    if (pathname !== '/launch' && !pathname.startsWith('/api')) {
      return NextResponse.redirect(new URL('/launch', request.url));
    }
  }

  // In 'live' mode: all routes pass through normally
  // /launch page handles its own "completed" state display via NEXT_PUBLIC_SITE_MODE
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all routes EXCEPT:
    // - _next/static (JS/CSS bundles)
    // - _next/image (image optimization)
    // - favicon.ico, icon.png, apple-icon.png (browser icons)
    // - Files with extensions in /public (scene images, etc.)
    '/((?!_next/static|_next/image|favicon\\.ico|icon\\.png|apple-icon\\.png|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|mp3|wav|ogg|woff|woff2|ttf|eot)$).*)',
  ],
};
