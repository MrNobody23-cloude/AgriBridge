import { NextResponse } from 'next/server';

const demoAccounts = [
    { email: 'farmer@agribridge.test', name: 'Test Farmer', role: 'FARMER' },
    { email: 'exporter@agribridge.test', name: 'Test Exporter', role: 'EXPORTER' },
    { email: 'transporter@agribridge.test', name: 'Test Transporter', role: 'TRANSPORTER' },
    { email: 'importer@agribridge.test', name: 'Test Importer', role: 'IMPORTER' },
    { email: 'retailer@agribridge.test', name: 'Test Retailer', role: 'RETAILER' },
    { email: 'consumer@agribridge.test', name: 'Test Consumer', role: 'CONSUMER' },
    { email: 'regulator@agribridge.test', name: 'Test Regulator', role: 'REGULATOR' },
    { email: 'admin@agribridge.test', name: 'Test Admin', role: 'ADMIN' },
];

export async function GET() {
    // Never publish test-account credentials in a production deployment.
    if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ success: false }, { status: 404 });
    }

    return NextResponse.json({
        success: true,
        data: {
            accounts: demoAccounts,
            password: process.env.TEST_USER_PASSWORD || 'SecretApp123!',
        },
    });
}
