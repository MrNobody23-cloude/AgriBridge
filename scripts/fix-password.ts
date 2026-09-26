import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function fixUser() {
    const defaultPassword = 'SecretApp123!';
    const hashedPassword = await bcrypt.hash(defaultPassword, 12);

    // Check if the user exists
    const user = await prisma.user.findUnique({
        where: { email: 'farmer@agribridge.test' }
    });

    if (user) {
        await prisma.user.update({
            where: { email: 'farmer@agribridge.test' },
            data: { password: hashedPassword }
        });
        console.log('Password for farmer@agribridge.test explicitly set to:', defaultPassword);
    } else {
        console.log('User farmer@agribridge.test does not exist!');
    }
}

fixUser()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
