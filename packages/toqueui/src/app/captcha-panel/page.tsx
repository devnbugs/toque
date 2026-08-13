import React from 'react';
import AppLayout from '@/components/AppLayout';
import CaptchaPanelContent from './components/CaptchaPanelContent';
import RoleGuard from '@/components/RoleGuard';

export default function CaptchaPanelPage() {
  return (
    <AppLayout activeRoute="/captcha-panel">
      <RoleGuard panel="captcha">
        <CaptchaPanelContent />
      </RoleGuard>
    </AppLayout>
  );
}
