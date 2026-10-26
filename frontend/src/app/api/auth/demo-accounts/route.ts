import { NextResponse } from 'next/server';

const demoAccounts = [
    { email: 'farmer@agribridge.test', name: 'Test Farmer', role: 'FARMER', defaultLocation: 'Sr. No. 47, Village - Avachitwadi, Goti, Igatpuri, Takeghoti, Nashik-422402, Maharashtra' },
    { email: 'transporter@agribridge.test', name: 'Test Transporter', role: 'TRANSPORTER' },
    { email: 'retailer@agribridge.test', name: 'Test Retailer', role: 'RETAILER', defaultLocation: 'Limbani Darshan, Near Tilak Nagar, Kalyan Road, Dombivli East, Thane-421201, Maharashtra' },
    { email: 'consumer@agribridge.test', name: 'Test Consumer', role: 'CONSUMER' },
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
