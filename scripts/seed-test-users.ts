import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

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
        { email: 'admin@agribridge.test', name: 'Test Admin', role: 'ADMIN', phone: '555-0108' }
    ];

    for (const testUser of testUsers) {
        const existing = await prisma.user.findUnique({ where: { email: testUser.email } });
        if (!existing) {
            await prisma.user.create({
                data: {
                    ...testUser,
                    password: hashedPassword,
                    ...(testUser.role === 'FARMER' ? {
                        farmerProfile: {
                            create: {
                                farmName: 'Test Farm',
                                district: 'Nashik',
                                state: 'Maharashtra',
                                location: 'Test Location'
                            }
                        }
                    } : {})
                }
            });
            console.log(`Created user: ${testUser.email} [${testUser.role}]`);
        } else {
            console.log(`User already exists: ${testUser.email}`);
        }
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
        await prisma.$disconnect();
    });
