import React from 'react';
import type { Metadata, Viewport } from 'next';
import { DM_Sans, JetBrains_Mono } from 'next/font/google';
import { Toaster } from 'sonner';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { AuthProvider } from '@/contexts/AuthContext';
import '../styles/tailwind.css';

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-dm-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  title: 'ToqueUI — Nusuk Visa Operations Command Center',
  description:
    'Interactive command-center dashboard for Toque/Nusuk CLI — automate Masar Nusuk Umrah visa operations via stealth headless browser.',
  icons: {
    icon: [{ url: '/favicon.ico', type: 'image/x-icon' }],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${jetbrainsMono.variable} dark`}
      suppressHydrationWarning
    >
      <head>
        {/* Inline script to apply saved theme before first paint — prevents flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var t = localStorage.getItem('toque_theme');
                  var root = document.documentElement;
                  if (t === 'light') {
                    root.classList.remove('dark');
                    root.classList.add('light');
                  } else {
                    root.classList.remove('light');
                    root.classList.add('dark');
                  }
                } catch(e) {}
              })();
            `,
          }}
        />

        <script
          type="module"
          async
          src="https://static.rocket.new/rocket-web.js?_cfg=https%3A%2F%2Ftoqueui8784back.builtwithrocket.new&_be=https%3A%2F%2Fappanalytics.rocket.new&_v=0.1.20"
        />
        <script type="module" defer src="https://static.rocket.new/rocket-shot.js?v=0.0.2" />
      </head>
      <body className={dmSans.className}>
        <AuthProvider>{children}</AuthProvider>
        <Toaster
          position="bottom-right"
          theme="dark"
          toastOptions={{
            style: {
              background: 'var(--card)',
              border: '1px solid var(--border)',
              color: 'var(--foreground)',
              fontFamily: 'var(--font-dm-sans)',
              fontSize: '13px',
            },
          }}
        />
        <SpeedInsights />
      </body>
    </html>
  );
}
