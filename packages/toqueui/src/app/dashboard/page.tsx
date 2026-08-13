import React from 'react';
import AppLayout from '@/components/AppLayout';
import AuthPanelContent from '@/app/components/AuthPanelContent';

export default function DashboardPage() {
  return (
    <AppLayout activeRoute="/dashboard">
      <AuthPanelContent />
    </AppLayout>
  );
}
