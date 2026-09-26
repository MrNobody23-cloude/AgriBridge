import { prisma } from '@/lib/prisma';

export interface FraudScanResult {
    batchId?: string;
    shipmentId?: string;
    fraudType: string;
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    description: string;
    confidence: number;
    flagged: boolean;
}

/**
 * Run comprehensive fraud detection scan on a batch or shipment.
 */
export async function runFraudScan(batchId: string, shipmentId?: string): Promise<FraudScanResult[]> {
    const results: FraudScanResult[] = [];

    const batch = await prisma.batch.findFirst({
        where: { OR: [{ id: batchId }, { batchCode: batchId }] },
        include: { certificates: true, events: true, shipments: true, temperatureLogs: true },
    });

    if (!batch) return results;

    // Rule 1: Duplicate Certificate Hash Scan
    for (const cert of batch.certificates) {
        const duplicateCert = await prisma.certificate.findFirst({
            where: {
                fileHash: cert.fileHash,
                batchId: { not: batch.id },
            },
            include: { batch: true },
        });

        if (duplicateCert) {
            const alert = {
                batchId: batch.id,
                shipmentId,
                fraudType: 'DUPLICATE_CERTIFICATE',
                severity: 'CRITICAL' as const,
                description: `Certificate hash '${cert.fileHash.slice(0, 12)}...' matches certificate previously uploaded for Batch ${duplicateCert.batch.batchCode}. Possible certificate reuse fraud!`,
                // A byte-identical hash match is a deterministic fact, not a
                // statistical estimate, so this is 1 rather than the 0.98 that
                // was previously typed in. The number is rendered to the
                // regulator as "Confidence Rating: 98%", which reads as a
                // calibrated probability of guilt — and no model here produces
                // one. It records how strongly the rule fired, nothing more.
                confidence: 1,
                flagged: true,
            };
            results.push(alert);

            // Create Fraud Alert in DB if not already exists
            await prisma.fraudAlert.create({
                data: {
                    batchId: batch.id,
                    shipmentId,
                    fraudType: alert.fraudType,
                    severity: alert.severity,
                    description: alert.description,
                    confidence: alert.confidence,
                    status: 'OPEN',
                },
            });

            // Update batch status to Flagged
            await prisma.batch.update({
                where: { id: batch.id },
                data: { status: 'Flagged' },
            });
        }

        // Rule 2: Expired Certificate Check
        if (new Date(cert.expiryDate) < new Date()) {
            const alert = {
                batchId: batch.id,
                shipmentId,
                fraudType: 'EXPIRED_CERTIFICATE',
                severity: 'HIGH' as const,
                description: `Certificate ${cert.certificateType} expired on ${new Date(cert.expiryDate).toLocaleDateString()}. Batch export halted.`,
                // The date comparison is deterministic; see Rule 1 for why
                // these are 1 rather than the 0.95 previously hardcoded.
                confidence: 1,
                flagged: true,
            };
            results.push(alert);

            await prisma.fraudAlert.create({
                data: {
                    batchId: batch.id,
                    shipmentId,
                    fraudType: alert.fraudType,
                    severity: alert.severity,
                    description: alert.description,
                    confidence: alert.confidence,
                    status: 'OPEN',
                },
            });
        }
    }

    // Rule 3: Cold Chain Temperature Breach Scan
    const tempBreaches = batch.temperatureLogs.filter((t) => t.temperature > 8.0 || t.temperature < 1.0);
    if (tempBreaches.length > 0) {
        const maxTemp = Math.max(...tempBreaches.map((t) => t.temperature));
        const alert = {
            batchId: batch.id,
            shipmentId,
            fraudType: 'TEMP_BREACH',
            severity: 'HIGH' as const,
            description: `Cold chain temperature breach detected! Temperature spiked to ${maxTemp}°C at ${tempBreaches[0].location}.`,
            // `tempBreaches` is the list of readings outside 0–8 °C. Its length
            // is known, not estimated; 0.91 discounted the finding for no
            // stated reason.
            confidence: 1,
            flagged: true,
        };
        results.push(alert);

        await prisma.fraudAlert.create({
            data: {
                batchId: batch.id,
                shipmentId,
                fraudType: alert.fraudType,
                severity: alert.severity,
                description: alert.description,
                confidence: alert.confidence,
                status: 'OPEN',
            },
        });
    }

    // Log AI Agent Scan Activity
    await prisma.aiAgentLog.create({
        data: {
            agentName: 'Fraud Detection Agent',
            task: `Fraud Scan on Batch ${batch.batchCode}`,
            input: `Batch ${batch.batchCode} with ${batch.certificates.length} certificates and ${batch.events.length} events`,
            output: results.length > 0 ? `FLAGGED: ${results.length} anomaly/fraud signature(s) detected` : 'PASSED: Zero fraud signatures detected',
            // How strongly this agent asserts depends only on whether the scan
            // found something, which is a count. It is not a probability that
            // the batch is fraudulent.
            confidence: 1,
            status: results.length > 0 ? 'FLAGGED' : 'PASSED',
        },
    });

    return results;
}
