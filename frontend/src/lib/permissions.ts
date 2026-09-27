export const ROLES = {
    FARMER: 'FARMER',
    EXPORTER: 'EXPORTER',
    TRANSPORTER: 'TRANSPORTER',
    IMPORTER: 'IMPORTER',
    RETAILER: 'RETAILER',
    CONSUMER: 'CONSUMER',
    REGULATOR: 'REGULATOR',
    ADMIN: 'ADMIN'
} as const;

export type Role = keyof typeof ROLES;

export const PERMISSIONS = {
    // Batches
    'batch:create': [ROLES.FARMER],
    'batch:read': [ROLES.FARMER, ROLES.EXPORTER, ROLES.TRANSPORTER, ROLES.IMPORTER, ROLES.RETAILER, ROLES.REGULATOR, ROLES.ADMIN, ROLES.CONSUMER],
    'batch:update': [ROLES.FARMER],
    'batch:delete': [ROLES.ADMIN],

    // Shipments
    'shipment:create': [ROLES.EXPORTER],
    'shipment:read': [ROLES.EXPORTER, ROLES.TRANSPORTER, ROLES.IMPORTER, ROLES.REGULATOR, ROLES.ADMIN],
    'shipment:update': [ROLES.EXPORTER, ROLES.TRANSPORTER, ROLES.IMPORTER],

    // Certificates
    'certificate:upload': [ROLES.FARMER, ROLES.EXPORTER],
    'certificate:verify': [ROLES.EXPORTER, ROLES.IMPORTER, ROLES.REGULATOR, ROLES.ADMIN],

    // IoT
    'iot:read': [ROLES.TRANSPORTER, ROLES.EXPORTER, ROLES.IMPORTER, ROLES.REGULATOR, ROLES.ADMIN],
    'iot:manage': [ROLES.TRANSPORTER, ROLES.ADMIN],

    // ML & AI
    'ml:predict': [ROLES.FARMER, ROLES.EXPORTER, ROLES.IMPORTER, ROLES.RETAILER, ROLES.REGULATOR, ROLES.ADMIN],
    'ml:view': [ROLES.FARMER, ROLES.EXPORTER, ROLES.IMPORTER, ROLES.RETAILER, ROLES.REGULATOR, ROLES.ADMIN],
    'ai:use': [ROLES.FARMER, ROLES.EXPORTER, ROLES.TRANSPORTER, ROLES.IMPORTER, ROLES.RETAILER, ROLES.REGULATOR, ROLES.ADMIN, ROLES.CONSUMER],

    // Audits and Regulators
    'fraud:view': [ROLES.REGULATOR, ROLES.ADMIN, ROLES.EXPORTER, ROLES.IMPORTER],
    'fraud:investigate': [ROLES.REGULATOR, ROLES.ADMIN],
    'compliance:view': [ROLES.EXPORTER, ROLES.IMPORTER, ROLES.REGULATOR, ROLES.ADMIN],
    'compliance:manage': [ROLES.REGULATOR, ROLES.ADMIN],
    'blockchain:verify': [ROLES.EXPORTER, ROLES.IMPORTER, ROLES.REGULATOR, ROLES.ADMIN, ROLES.CONSUMER],

    // System
    'audit:view': [ROLES.REGULATOR, ROLES.ADMIN],
    'users:manage': [ROLES.ADMIN],
    'system:manage': [ROLES.ADMIN],
} as const;

export type Permission = keyof typeof PERMISSIONS;

export function hasPermission(role: Role | string | undefined, permission: Permission): boolean {
    if (!role) return false;
    const allowedRoles = PERMISSIONS[permission] as readonly string[];
    return allowedRoles.includes(role);
}
