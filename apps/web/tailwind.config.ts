import type { Config } from 'tailwindcss';

const brandScale = Object.fromEntries(
  [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((n) => [n, `hsl(var(--brand-${n}) / <alpha-value>)`]),
);

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    container: {
      center: true,
      padding: { DEFAULT: '1rem', md: '2rem' },
      screens: { '2xl': '1400px' },
    },
    extend: {
      colors: {
        // shadcn/ui CSS-variable tokens
        border:       'hsl(var(--border))',
        input:        'hsl(var(--input))',
        ring:         'hsl(var(--ring))',
        background:   'hsl(var(--background))',
        foreground:   'hsl(var(--foreground))',
        primary: {
          DEFAULT:    'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          ...brandScale,
        },
        // Legacy blue-* utilities follow the active theme's brand colour
        blue: brandScale,
        secondary: {
          DEFAULT:    'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT:    'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT:    'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT:    'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT:    'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT:    'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Semantic status tokens (light/dark values live in globals.css)
        success: { DEFAULT: 'hsl(var(--success))', foreground: 'hsl(var(--success-foreground))' },
        warning: { DEFAULT: 'hsl(var(--warning))', foreground: 'hsl(var(--warning-foreground))' },
        info:    { DEFAULT: 'hsl(var(--info))',    foreground: 'hsl(var(--info-foreground))' },
        // Neutral scale is theme-aware: the existing slate-* utilities flip automatically in dark mode
        slate: Object.fromEntries(
          [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((n) => [n, `hsl(var(--slate-${n}) / <alpha-value>)`]),
        ),
        // Brand
        teal: { 50: '#F0FDFA', 500: '#14B8A6', 600: '#0D9488' },
        surface: 'hsl(var(--surface))',
        sidebar: {
          DEFAULT:    'hsl(var(--sidebar))',
          foreground: 'hsl(var(--sidebar-foreground))',
          muted:      'hsl(var(--sidebar-muted))',
          hover:      'hsl(var(--sidebar-hover))',
          border:     'hsl(var(--sidebar-border))',
          active:     'hsl(var(--sidebar-active))',
        },
        chart: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((n) => [n, `hsl(var(--chart-${n}) / <alpha-value>)`])),
      },
      borderRadius: {
        lg:  'var(--radius)',
        md:  'calc(var(--radius) - 2px)',
        sm:  'calc(var(--radius) - 4px)',
        xl:  '0.75rem',
        '2xl': '1rem',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'Georgia', 'serif'],
      },
      fontSize: {
        // Type scale: [size, line-height]
        // Fluid scale (clamp): readable on 320px phones, roomy on desktop
        display: ['clamp(1.5rem, 1.1rem + 1.8vw, 2.25rem)', { lineHeight: '1.15', letterSpacing: '-0.02em', fontWeight: '600' }],
        title:   ['clamp(1.125rem, 1rem + 0.6vw, 1.375rem)', { lineHeight: '1.3', letterSpacing: '-0.01em', fontWeight: '600' }],
        stat:    ['clamp(1.375rem, 1.1rem + 1vw, 1.875rem)', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '700' }],
      },
      boxShadow: {
        card:    'var(--shadow-card)',
        popover: 'var(--shadow-popover)',
      },
      keyframes: {
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up':   { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
        'fade-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up':   'accordion-up 0.2s ease-out',
        'fade-in':        'fade-in 0.2s ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
