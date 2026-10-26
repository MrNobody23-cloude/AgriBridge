import type { Role } from './permissions';

/** Role-specific dashboards are private to that role. Shared tools are kept
 * separate so a permission can never accidentally expose another dashboard. */
export const DASHBOARD_BY_ROLE: Record<Role, string> = {
    FARMER: '/farmer',
    TRANSPORTER: '/transporter',
    RETAILER: '/retailer',
    CONSUMER: '/consumer',
    ADMIN: '/admin',
};

export const ROLE_BY_DASHBOARD: Record<string, Role> = Object.fromEntries(
    Object.entries(DASHBOARD_BY_ROLE).map(([role, path]) => [path, role])
) as Record<string, Role>;

export function roleForDashboardPath(pathname: string): Role | undefined {
    const match = Object.entries(DASHBOARD_BY_ROLE)
        .find(([, path]) => pathname === path || pathname.startsWith(`${path}/`));
    return match?.[0] as Role | undefined;
}

export function dashboardForRole(role: string | undefined): string {
    return role && role in DASHBOARD_BY_ROLE
        ? DASHBOARD_BY_ROLE[role as Role]
        : '/login';
}
