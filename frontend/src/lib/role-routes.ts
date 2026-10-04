import type { Role } from './permissions';

/** Role-specific dashboards are private to that role. Shared tools are kept
 * separate so a permission can never accidentally expose another dashboard. */
export const DASHBOARD_BY_ROLE: Record<Role, string> = {
    FARMER: '/farmer',
    EXPORTER: '/exporter',
    TRANSPORTER: '/transporter',
    IMPORTER: '/importer',
    RETAILER: '/retailer',
    CONSUMER: '/consumer',
    REGULATOR: '/regulator',
    ADMIN: '/admin',
};

export const ROLE_BY_DASHBOARD: Record<string, Role> = Object.fromEntries(
    Object.entries(DASHBOARD_BY_ROLE).map(([role, path]) => [path, role])
) as Record<string, Role>;

export function dashboardForRole(role: string | undefined): string {
    return role && role in DASHBOARD_BY_ROLE
        ? DASHBOARD_BY_ROLE[role as Role]
        : '/login';
}
