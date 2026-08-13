import React from 'react';
import AppLayout from '@/components/AppLayout';
import TeamManagementContent from './components/TeamManagementContent';
import RoleGuard from '@/components/RoleGuard';

export default function TeamManagementPage() {
  return (
    <AppLayout activeRoute="/team-management">
      <RoleGuard panel="team-management">
        <TeamManagementContent />
      </RoleGuard>
    </AppLayout>
  );
}
