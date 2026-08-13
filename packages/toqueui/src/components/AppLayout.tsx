'use client';

import React, { useState } from 'react';
import Sidebar from './Sidebar';
import TopHeader from './TopHeader';
import { ThemeProvider } from '@/context/ThemeContext';

interface AppLayoutProps {
  children: React.ReactNode;
  activeRoute: string;
}

export default function AppLayout({ children, activeRoute }: AppLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <ThemeProvider>
      <div
        className="flex h-screen overflow-hidden"
        style={{ backgroundColor: 'var(--background)' }}
      >
        {/* Mobile backdrop */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/60 md:hidden animate-fade-in"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
        )}

        {/* Sidebar: off-canvas on mobile, static on md+ */}
        <div
          className={`z-50 h-full md:relative md:flex ${mobileOpen ? 'fixed' : 'hidden md:flex'}`}
        >
          <Sidebar
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed((prev) => !prev)}
            activeRoute={activeRoute}
            onNavigate={() => setMobileOpen(false)}
          />
        </div>

        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <TopHeader
            sidebarCollapsed={sidebarCollapsed}
            onMobileMenu={() => setMobileOpen((v) => !v)}
          />
          <main
            className="flex-1 overflow-y-auto px-4 py-5 md:px-6 md:py-6 xl:px-8 2xl:px-10"
            style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 1200px' }}
          >
            {children}
          </main>
        </div>
      </div>
    </ThemeProvider>
  );
}
