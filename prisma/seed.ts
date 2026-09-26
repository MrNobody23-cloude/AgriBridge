import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Seeding AgriBridge AI Database...');

    // Password hashing (consistent Password123! for test accounts)
    const passwordHash = await bcrypt.hash('Password123!', 10);

    // 1. Seed All 8 Users & Roles
    const farmerUser = await prisma.user.upsert({
        where: { email: 'farmer@agribridge.ai' },
        update: {},
        create: {
            name: 'Rajesh Kumar',
            email: 'farmer@agribridge.ai',
            password: passwordHash,
            role: 'FARMER',
            phone: '+91 98765 43210',
            farmerProfile: {
                create: {
                    farmName: 'Kumar Organic Farms',
                    location: 'Nashik, Maharashtra',
                    state: 'Maharashtra',
                    district: 'Nashik',
                },
            },
        },
    });

    const exporterUser = await prisma.user.upsert({
        where: { email: 'exporter@agribridge.ai' },
        update: {},
        create: {
            name: 'Sunrise Global Exports Ltd',
            email: 'exporter@agribridge.ai',
            password: passwordHash,
            role: 'EXPORTER',
            phone: '+91 98111 22334',
        },
    });

    const transporterUser = await prisma.user.upsert({
        where: { email: 'transporter@agribridge.ai' },
        update: {},
        create: {
            name: 'ColdChain Express Logistics',
            email: 'transporter@agribridge.ai',
            password: passwordHash,
            role: 'TRANSPORTER',
            phone: '+91 98222 33445',
        },
    });

    const importerUser = await prisma.user.upsert({
        where: { email: 'importer@agribridge.ai' },
        update: {},
        create: {
            name: 'EuroFresh Imports BV',
            email: 'importer@agribridge.ai',
            password: passwordHash,
            role: 'IMPORTER',
            phone: '+31 20 123 4567',
        },
    });

    const retailerUser = await prisma.user.upsert({
        where: { email: 'retailer@agribridge.ai' },
        update: {},
        create: {
            name: 'Marks & Spencers Agro Mart',
            email: 'retailer@agribridge.ai',
            password: passwordHash,
            role: 'RETAILER',
            phone: '+44 20 7946 0912',
        },
    });

    const consumerUser = await prisma.user.upsert({
        where: { email: 'consumer@agribridge.ai' },
        update: {},
        create: {
            name: 'Aaditya Verma',
            email: 'consumer@agribridge.ai',
            password: passwordHash,
            role: 'CONSUMER',
            phone: '+91 99000 11223',
        },
    });

    const regulatorUser = await prisma.user.upsert({
        where: { email: 'regulator@agribridge.ai' },
        update: {},
        create: {
            name: 'Dr. Amit Sharma (FSSAI/APEDA Inspector)',
            email: 'regulator@agribridge.ai',
            password: passwordHash,
            role: 'REGULATOR',
            phone: '+91 91111 55555',
        },
    });

    const adminUser = await prisma.user.upsert({
        where: { email: 'admin@agribridge.ai' },
        update: {},
        create: {
            name: 'AgriBridge System Administrator',
            email: 'admin@agribridge.ai',
            password: passwordHash,
            role: 'ADMIN',
            phone: '+91 90000 00000',
        },
    });

    console.log('👤 All 8 user roles seeded successfully.');

    // 2. Seed Master Products
    const mango = await prisma.product.upsert({
        where: { name: 'Alphonso Mango' },
        update: {},
        create: {
            name: 'Alphonso Mango',
            category: 'Fruits',
            description: 'GI-tagged premium export grade Alphonso Mangoes from Ratnagiri/Nashik belt.',
        },
    });

    const rice = await prisma.product.upsert({
        where: { name: 'Basmati Rice' },
        update: {},
        create: {
            name: 'Basmati Rice',
            category: 'Grains',
            description: 'Aromatic long-grain 1121 Basmati Rice harvested from Punjab plains.',
        },
    });

    const grapes = await prisma.product.upsert({
        where: { name: 'Nashik Grapes' },
        update: {},
        create: {
            name: 'Nashik Grapes',
            category: 'Fruits',
            description: 'Export grade seedless table grapes compliant with APEDA GrapeNet protocol.',
        },
    });

    const saffron = await prisma.product.upsert({
        where: { name: 'Kesar Saffron' },
        update: {},
        create: {
            name: 'Kesar Saffron',
            category: 'Spices',
            description: 'Grade 1 ISO 3632 certified pure Kashmir Saffron with high safranal content.',
        },
    });

    const tea = await prisma.product.upsert({
        where: { name: 'Darjeeling Tea' },
        update: {},
        create: {
            name: 'Darjeeling Tea',
            category: 'Beverages',
            description: 'First flush organic GI-certified tea leaves from high elevation Darjeeling estates.',
        },
    });

    console.log('🌾 Master products seeded successfully.');

    // 3. Seed Batches
    const batch1 = await prisma.batch.upsert({
        where: { batchCode: 'AGR-2026-UK-284701' },
        update: {},
        create: {
            batchCode: 'AGR-2026-UK-284701',
            farmerId: farmerUser.id,
            productId: mango.id,
            quantity: 2400,
            harvestDate: new Date('2026-03-12'),
            location: 'Nashik, Maharashtra',
            destinationCountry: 'UK',
            status: 'EXPORTED',
            blockchainHash: '0x7f3a89a2b4c1d6e8f9a0b2c4d6e8f0a2b4c6d8e0f2a4b6c8d0e2f4a6b8c0d2e4',
            blockchainTransactionHash: '0x7f3a1234567890abcdef1234567890abcdef1234567890abcdef12345678904d92',
            trustScore: 89,
        },
    });

    const batch2 = await prisma.batch.upsert({
        where: { batchCode: 'AGR-2026-EU-284102' },
        update: {},
        create: {
            batchCode: 'AGR-2026-EU-284102',
            farmerId: farmerUser.id,
            productId: grapes.id,
            quantity: 1800,
            harvestDate: new Date('2026-03-08'),
            location: 'Nashik, Maharashtra',
            destinationCountry: 'EU',
            status: 'IN_TRANSIT',
            blockchainHash: '0x3b1c90e1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9',
            blockchainTransactionHash: '0x3b1c90e1888877776666555544443333222211110000aaaabbbbccccddddeeee',
            trustScore: 76,
        },
    });

    const batch3 = await prisma.batch.upsert({
        where: { batchCode: 'AGR-2026-US-283503' },
        update: {},
        create: {
            batchCode: 'AGR-2026-US-283503',
            farmerId: farmerUser.id,
            productId: rice.id,
            quantity: 5200,
            harvestDate: new Date('2026-03-02'),
            location: 'Amritsar, Punjab',
            destinationCountry: 'US',
            status: 'DELIVERED',
            blockchainHash: '0x9d4e11c4a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9',
            blockchainTransactionHash: '0x9d4e11c49999888877776666555544443333222211110000aaaabbbbccccdddd',
            trustScore: 94,
        },
    });

    console.log('📦 Batches seeded successfully.');

    // 4. Seed Certificates
    await prisma.certificate.createMany({
        data: [
            {
                batchId: batch1.id,
                certificateType: 'APEDA Phytosanitary Certificate',
                fileUrl: 'https://gateway.pinata.cloud/ipfs/QmZtmD2qt8fJpq3CLDH8tfGeiPqMSvNWLBHBxyhnGWDpZ1',
                fileHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
                ipfsHash: 'QmZtmD2qt8fJpq3CLDH8tfGeiPqMSvNWLBHBxyhnGWDpZ1',
                issuer: 'APEDA Regional Office Mumbai',
                issueDate: new Date('2026-03-13'),
                expiryDate: new Date('2027-03-13'),
                verificationStatus: 'VERIFIED',
            },
            {
                batchId: batch2.id,
                certificateType: 'GLOBALG.A.P Organic Certificate',
                fileUrl: 'https://gateway.pinata.cloud/ipfs/QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco',
                fileHash: 'f4c8996fb92427ae41e4649b934ca495991b7852b855e3b0c44298fc1c149afb',
                ipfsHash: 'QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco',
                issuer: 'Control Union Certifications India',
                issueDate: new Date('2026-03-09'),
                expiryDate: new Date('2027-03-09'),
                verificationStatus: 'VERIFIED',
            },
            {
                batchId: batch3.id,
                certificateType: 'US FDA Food Facility Registration',
                fileUrl: 'https://gateway.pinata.cloud/ipfs/QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
                fileHash: '7852b855e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b',
                ipfsHash: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
                issuer: 'U.S. Food and Drug Administration',
                issueDate: new Date('2026-03-03'),
                expiryDate: new Date('2028-03-03'),
                verificationStatus: 'VERIFIED',
            },
        ],
    });

    // 5. Seed Shipments
    const shipment1 = await prisma.shipment.upsert({
        where: { shipmentCode: 'EX-1923' },
        update: {},
        create: {
            shipmentCode: 'EX-1923',
            batchId: batch1.id,
            exporterId: exporterUser.id,
            transporterId: transporterUser.id,
            destinationCountry: 'UK',
            quantity: 2400,
            status: 'In Transit',
            riskScore: 12,
        },
    });

    const shipment2 = await prisma.shipment.upsert({
        where: { shipmentCode: 'EX-1917' },
        update: {},
        create: {
            shipmentCode: 'EX-1917',
            batchId: batch2.id,
            exporterId: exporterUser.id,
            transporterId: transporterUser.id,
            destinationCountry: 'EU',
            quantity: 1800,
            status: 'In Transit',
            riskScore: 28,
        },
    });

    console.log('🚢 Shipments seeded successfully.');

    // 6. Seed Temperature Logs (IoT Cold Chain)
    const now = Date.now();
    const tempReadings = [];
    for (let i = 24; i >= 0; i--) {
        const timestamp = new Date(now - i * 3600 * 1000);
        // Normal reefer container 12-14°C with a minor spike at hour 6
        const temp = i === 6 ? 17.5 : 12.5 + (Math.sin(i) * 0.8);
        const hum = 85.0 + (Math.cos(i) * 2.0);
        const isBreached = temp > 15.0;

        tempReadings.push({
            batchId: batch1.id,
            temperature: parseFloat(temp.toFixed(2)),
            humidity: parseFloat(hum.toFixed(2)),
            batteryPct: 94.0 - (24 - i) * 0.1,
            sensorId: 'IOT-REEFER-001',
            location: i > 12 ? 'Mumbai JNPT Port' : 'Arabian Sea Vessel',
            timestamp,
        });
    }

    await prisma.temperatureLog.createMany({
        data: tempReadings,
    });

    console.log('🌡️ Temperature IoT logs seeded successfully.');

    // 7. Seed Trust Scores
    await prisma.trustScore.upsert({
        where: { batchId: batch1.id },
        update: {},
        create: {
            batchId: batch1.id,
            blockchainScore: 19,
            certificateScore: 18,
            coldChainScore: 17,
            inspectionScore: 18,
            complianceScore: 17,
            qualityScore: 10,
            finalScore: 89,
            factorsJson: JSON.stringify([
                { name: 'Blockchain Verification', score: 19, max: 20, desc: 'Batch cryptographic hash anchored to Polygon Amoy ledger', shap: 3.5 },
                { name: 'Certificate Authenticity', score: 18, max: 20, desc: 'APEDA Phytosanitary certificate verified with IPFS CID', shap: 2.8 },
                { name: 'Cold Chain Integrity', score: 17, max: 20, desc: '98.2% compliance within 10-15°C target temperature', shap: 1.2 },
                { name: 'Inspection Results', score: 18, max: 20, desc: 'APEDA pre-shipment Grade A export classification', shap: 2.9 },
                { name: 'Regulatory Compliance', score: 17, max: 20, desc: 'UK Plant Health & pesticide MRL standards verified via RAG', shap: 2.1 },
            ]),
            explanation: 'Alphonso Mango batch AGR-2026-UK-284701 holds an exemplary Trust Score of 89/100. Immutable blockchain lineage and authentic IPFS certificates guarantee quality.',
        },
    });

    // 8. Seed Supply Chain Events
    await prisma.supplyChainEvent.createMany({
        data: [
            {
                batchId: batch1.id,
                eventType: 'FARM_REGISTERED',
                actorId: farmerUser.id,
                actorRole: 'FARMER',
                location: 'Nashik, Maharashtra',
                metadata: 'Farm registration confirmed with APEDA ID #MH-9924',
                blockchainTransactionHash: '0x7f3a1234567890abcdef1234567890abcdef1234567890abcdef12345678904d92',
            },
            {
                batchId: batch1.id,
                eventType: 'HARVESTED',
                actorId: farmerUser.id,
                actorRole: 'FARMER',
                location: 'Nashik, Maharashtra',
                metadata: '2,400 kg harvested at 80% maturity stage',
            },
            {
                batchId: batch1.id,
                eventType: 'TRANSFERRED_TO_MANDI',
                actorId: farmerUser.id,
                actorRole: 'FARMER',
                location: 'APMC Nashik Hub',
                metadata: 'Primary grading passed Grade A',
            },
            {
                batchId: batch1.id,
                eventType: 'EXPORTED',
                actorId: exporterUser.id,
                actorRole: 'EXPORTER',
                location: 'JNPT Port, Mumbai',
                metadata: 'Loaded into reefer container #MAEU-9912 at 13°C',
            },
        ],
    });

    // 9. Seed AI Agent Logs
    await prisma.aiAgentLog.createMany({
        data: [
            {
                agentName: 'Traceability Agent',
                agentType: 'traceability',
                task: 'Polygon On-Chain State Verification',
                input: 'Batch AGR-2026-UK-284701',
                output: 'CONFIRMED: Batch hash verified on Polygon Amoy testnet contract.',
                confidence: 0.99,
                status: 'PASSED',
            },
            {
                agentName: 'Fraud Detection Agent',
                agentType: 'fraud',
                task: 'Certificate Hash Anomaly Scan',
                input: 'Pinata IPFS CID QmZtmD2qt8fJpq3CLDH8tfGeiPqMSvNWLBHBxyhnGWDpZ1',
                output: 'PASSED: Certificate SHA-256 matches uncollided authority stamp.',
                confidence: 0.98,
                status: 'PASSED',
            },
            {
                agentName: 'Compliance Agent (RAG)',
                agentType: 'compliance',
                task: 'UK Plant Health & Import MRL Audit',
                input: 'Country: UK, Crop: Alphonso Mango',
                output: 'PASSED: Compliant with UK Plant Health Act 2020 and GB MRL standards.',
                confidence: 0.96,
                status: 'PASSED',
            },
        ],
    });

    console.log('✅ AgriBridge AI Seeding Completed Successfully!');
}

main()
    .catch((e) => {
        console.error('❌ Seeding failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
