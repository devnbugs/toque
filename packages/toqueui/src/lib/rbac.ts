// Role-Based Access Control definitions

export type UserRole = 'super_admin' | 'admin' | 'operator' | 'viewer';

export type Panel =
  | 'send-visa'
  | 'schedule'
  | 'captcha'
  | 'benchmarking'
  | 'pulling'
  | 'network'
  | 'api-builder'
  | 'dashboard'
  | 'team-management';

// Panel access matrix: which roles can access each panel
export const PANEL_PERMISSIONS: Record<Panel, UserRole[]> = {
  dashboard: ['super_admin', 'admin', 'operator', 'viewer'],
  pulling: ['super_admin', 'admin', 'operator', 'viewer'],
  network: ['super_admin', 'admin', 'operator', 'viewer'],
  'api-builder': ['super_admin', 'admin', 'operator', 'viewer'],
  // Restricted panels
  'send-visa': ['super_admin', 'admin', 'operator'],
  schedule: ['super_admin', 'admin', 'operator'],
  captcha: ['super_admin', 'admin', 'operator'],
  benchmarking: ['super_admin', 'admin'],
  // Admin-only
  'team-management': ['super_admin', 'admin'],
};

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  operator: 'Operator',
  viewer: 'Viewer',
};

export const ROLE_COLORS: Record<UserRole, string> = {
  super_admin: 'text-purple-400 bg-purple-400/10 border-purple-400/20',
  admin: 'text-red-400 bg-red-400/10 border-red-400/20',
  operator: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
  viewer: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
};

export function canAccessPanel(role: UserRole | null | undefined, panel: Panel): boolean {
  if (!role) return false;
  // super_admin has unrestricted access to all panels
  if (role === 'super_admin') return true;
  return PANEL_PERMISSIONS[panel]?.includes(role) ?? false;
}

export function getAccessDeniedMessage(role: UserRole | null | undefined, panel: Panel): string {
  const roleLabel = role ? ROLE_LABELS[role] : 'Unknown';
  const allowed = PANEL_PERMISSIONS[panel]?.map((r) => ROLE_LABELS[r]).join(', ') ?? '';
  return `Access denied. The "${panel}" panel requires: ${allowed}. Your role: ${roleLabel}.`;
}
