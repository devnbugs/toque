import React from 'react';
import AppLayout from '@/components/AppLayout';
import SchedulePanelContent from './components/SchedulePanelContent';
import RoleGuard from '@/components/RoleGuard';

export default function SchedulePanelPage() {
  return (
    <AppLayout activeRoute="/schedule-panel">
      <RoleGuard panel="schedule">
        <SchedulePanelContent />
      </RoleGuard>
    </AppLayout>
  );
}
