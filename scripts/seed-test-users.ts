import bcrypt from 'bcryptjs';
import { disconnectFromDatabase } from '../src/lib/db/connection';
import {
    findUserByEmail, createUser, createUserWithProfile,
} from '../src/lib/db/repositories/users';

/**
 * Seed one account per role for local development and the demo.
 *
 * Idempotent on `email`, which carries a unique index — re-running updates
 * nothing and creates nothing. It does **not** reset an existing password: a
 * re-run is not a way to get back into an account whose password you have
 * changed. That is a deliberate difference from a naive "upsert and overwrite".
 */

async function seedTestUsers() {
    console.log('Seeding test accounts...');
    const defaultPassword = process.env.TEST_USER_PASSWORD || 'SecretApp123!';
    const hashedPassword = await bcrypt.hash(defaultPassword, 12);

    const testUsers = [
        { email: 'farmer@agribridge.test', name: 'Test Farmer', role: 'FARMER', phone: '555-0101' },
        { email: 'exporter@agribridge.test', name: 'Test Exporter', role: 'EXPORTER', phone: '555-0102' },
        { email: 'transporter@agribridge.test', name: 'Test Transporter', role: 'TRANSPORTER', phone: '555-0103' },
        { email: 'importer@agribridge.test', name: 'Test Importer', role: 'IMPORTER', phone: '555-0104' },
        { email: 'retailer@agribridge.test', name: 'Test Retailer', role: 'RETAILER', phone: '555-0105' },
        { email: 'consumer@agribridge.test', name: 'Test Consumer', role: 'CONSUMER', phone: '555-0106' },
        { email: 'regulator@agribridge.test', name: 'Test Regulator', role: 'REGULATOR', phone: '555-0107' },
        { email: 'admin@agribridge.test', name: 'Test Admin', role: 'ADMIN', phone: '555-0108' },
    ];

    for (const testUser of testUsers) {
        const existing = await findUserByEmail(testUser.email);
        if (existing) {
            console.log(`User already exists: ${testUser.email}`);
            continue;
        }

        if (testUser.role === 'FARMER') {
            // One write, both documents — see `createUserWithProfile`. A farmer
            // without a profile cannot log in and repair it.
            await createUserWithProfile({
                name: testUser.name,
                email: testUser.email,
                password: hashedPassword,
                role: testUser.role,
                phone: testUser.phone,
                farmerProfile: {
                    farmName: 'Test Farm',
                    district: 'Nashik',
                    state: 'Maharashtra',
                    location: 'Test Location',
                },
            });
        } else {
            await createUser({
                name: testUser.name,
                email: testUser.email,
                password: hashedPassword,
                role: testUser.role,
                phone: testUser.phone,
            });
        }
        console.log(`Created user: ${testUser.email} [${testUser.role}]`);
    }

    console.log(`\nSeed complete!`);
    console.log(`All accounts use the password: ${defaultPassword}`);
}

seedTestUsers()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await disconnectFromDatabase();
    });
