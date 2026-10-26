export const ROLES = {
    FARMER: 'FARMER',
    TRANSPORTER: 'TRANSPORTER',
    RETAILER: 'RETAILER',
    CONSUMER: 'CONSUMER',
    ADMIN: 'ADMIN'
} as const;

export type Role = keyof typeof ROLES;

export const PERMISSIONS = {
    // Batches
    'batch:create': [ROLES.FARMER],
    'batch:read': [ROLES.FARMER, ROLES.TRANSPORTER, ROLES.RETAILER, ROLES.ADMIN, ROLES.CONSUMER],
    'batch:update': [ROLES.FARMER],
    'batch:delete': [ROLES.ADMIN],

    // Shipments
    'shipment:create': [ROLES.ADMIN],
    'shipment:read': [ROLES.TRANSPORTER, ROLES.ADMIN],
    'shipment:update': [ROLES.TRANSPORTER],

    'marketplace:manage': [ROLES.TRANSPORTER],

    // Certificates
    'certificate:upload': [ROLES.FARMER],
    'certificate:verify': [ROLES.ADMIN],

    // Sensor history is outside the transporter workflow.
    'iot:read': [ROLES.FARMER, ROLES.ADMIN],
    'iot:manage': [ROLES.ADMIN],

    // IoT

    // ML & AI
    'ml:predict': [ROLES.FARMER, ROLES.RETAILER, ROLES.ADMIN],
    'ml:view': [ROLES.FARMER, ROLES.RETAILER, ROLES.ADMIN],
    'ai:use': [ROLES.FARMER, ROLES.TRANSPORTER, ROLES.RETAILER, ROLES.ADMIN, ROLES.CONSUMER],

    // Audits and Regulators
    'fraud:view': [ROLES.ADMIN],
    'fraud:investigate': [ROLES.ADMIN],
    'compliance:view': [ROLES.ADMIN],
    'compliance:manage': [ROLES.ADMIN],
    'blockchain:verify': [ROLES.TRANSPORTER, ROLES.ADMIN, ROLES.CONSUMER],

    // System
    'audit:view': [ROLES.ADMIN],
    'users:manage': [ROLES.ADMIN],
    'system:manage': [ROLES.ADMIN],
} as const;

export type Permission = keyof typeof PERMISSIONS;

export function hasPermission(role: Role | string | undefined, permission: Permission): boolean {
    if (!role) return false;
    const allowedRoles = PERMISSIONS[permission] as readonly string[];
    return allowedRoles.includes(role);
}
