/** @type {import('next').NextConfig} */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// Content-Security-Policy — defence against XSS and data injection
const CSP = [
  "default-src 'self'",
  `connect-src 'self' ${API_URL} https://api.razorpay.com https://checkout.razorpay.com`,
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com",  // unsafe-eval needed by Next.js dev HMR; restrict in prod
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://dentalease-documents.s3.ap-south-1.amazonaws.com https://ui-avatars.com",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy',         value: CSP },
  { key: 'X-Frame-Options',                 value: 'DENY' },
  { key: 'X-Content-Type-Options',          value: 'nosniff' },
  { key: 'X-XSS-Protection',                value: '1; mode=block' },
  { key: 'Referrer-Policy',                 value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy',              value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security',       value: 'max-age=63072000; includeSubDomains; preload' },
];

const nextConfig = {
  experimental: { typedRoutes: true },

  images: {
    domains: [
      'dentalease-documents.s3.ap-south-1.amazonaws.com',
      'ui-avatars.com',
    ],
  },

  env: {
    NEXT_PUBLIC_API_URL:         process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_RAZORPAY_KEY:    process.env.RAZORPAY_KEY_ID,
  },

  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },

  // Disable powered-by header
  poweredByHeader: false,
};

module.exports = nextConfig;
