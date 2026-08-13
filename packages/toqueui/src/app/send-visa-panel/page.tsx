import React from 'react';
import AppLayout from '@/components/AppLayout';
import SendVisaPanelContent from './components/SendVisaPanelContent';
import RoleGuard from '@/components/RoleGuard';

export default function SendVisaPanelPage() {
  return (
    <AppLayout activeRoute="/send-visa-panel">
      <RoleGuard panel="send-visa">
        <SendVisaPanelContent />
      </RoleGuard>
    </AppLayout>
  );
}
