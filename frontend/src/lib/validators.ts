import { z } from 'zod';

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const registerSchema = z.object({
    name: z.string().min(2, 'Name must be at least 2 characters').max(100),
    email: z.string().email('Invalid email address').toLowerCase(),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    role: z.enum(['FARMER', 'EXPORTER', 'TRANSPORTER', 'IMPORTER', 'RETAILER', 'CONSUMER']).default('FARMER'),
    phone: z.string().optional(),
    // Farmer-specific fields
    farmName: z.string().optional(),
    location: z.string().optional(),
    state: z.string().optional(),
    district: z.string().optional(),
});

export const loginSchema = z.object({
    email: z.string().email('Invalid email address').toLowerCase(),
    password: z.string().min(1, 'Password is required'),
});

// ─── Batches ──────────────────────────────────────────────────────────────────

export const createBatchSchema = z.object({
    crop: z.string().trim().min(1, 'Crop type is required').max(100),
    variety: z.string().optional(),
    quantity: z.number().positive('Quantity must be a positive number'),
    unit: z.string().optional().default('kg'),
    harvestDate: z.string().min(1, 'Harvest date is required'),
    sowingDate: z.string().optional(),
    location: z.string().min(1, 'Farm location is required').max(200),
    destinationCountry: z.string().optional(),
    // Optional certificate info
    certificateUrl: z.string().url('Certificate URL must be a valid URL').optional(),
    certificateType: z.string().optional(),
    certIssuer: z.string().optional(),
});

// ─── Shipments ────────────────────────────────────────────────────────────────

export const createShipmentSchema = z.object({
    batchId: z.string().min(1, 'Batch ID is required'),
    destinationCountry: z.string().min(1, 'Destination country is required').max(100),
    quantity: z.number().positive('Quantity must be a positive number'),
    unit: z.string().optional().default('kg'),
    estimatedArrival: z.string().optional(),
});

// ─── Certificates ─────────────────────────────────────────────────────────────

export const certificateUploadSchema = z.object({
    batchId: z.string().min(1, 'Batch ID is required'),
    certificateType: z.string().min(1, 'Certificate type is required'),
    fileUrl: z.string().optional(),
    fileName: z.string().max(255).optional(),
    fileHash: z.string().length(64, 'File hash must be a 64-character SHA-256 hex string'),
    issuer: z.string().min(1, 'Issuer name is required'),
    issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Issue date must be YYYY-MM-DD'),
    expiryDate: z.string().min(1, 'Expiry date is required'),
    // Supply either a pre-pinned IPFS hash or raw base64 file content for pinning
    ipfsHash: z.string().optional(),
    fileBase64: z.string().optional(),
}).refine((d) => {
    const issued = new Date(`${d.issueDate}T00:00:00Z`);
    const expires = new Date(d.expiryDate);
    return Number.isFinite(issued.getTime()) && Number.isFinite(expires.getTime()) && expires > issued && issued <= new Date();
}, { message: 'Certificate dates must be valid, with expiry after issue and issue date not in the future', path: ['expiryDate'] }).refine(
    (d) => d.fileUrl || d.fileBase64 || d.ipfsHash,
    { message: 'Provide fileUrl, fileBase64, or ipfsHash', path: ['fileUrl'] }
);

// ─── IoT / Sensor readings ────────────────────────────────────────────────────

export const sensorReadingSchema = z.object({
    batchId: z.string().optional(),
    shipmentId: z.string().optional(),
    sensorId: z.string().min(1, 'Sensor ID is required'),
    temperature: z.number().min(-50, 'Temperature too low').max(80, 'Temperature too high'),
    humidity: z.number().min(0).max(100).optional(),
    location: z.string().min(1, 'Location is required'),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    batteryLevel: z.number().min(0).max(100).optional(),
    timestamp: z.string().optional(),
    isSimulated: z.boolean().optional().default(false),
});

// ─── ML Prediction requests ───────────────────────────────────────────────────

export const spoilagePredictionSchema = z.object({
    batchId: z.string().min(1, 'Batch ID is required'),
    temperature: z.number().min(-20).max(60),
    humidity: z.number().min(0).max(100).optional(),
    transitDays: z.number().int().min(0).max(365),
    storageType: z.string().optional(),
});

export const qualityPredictionSchema = z.object({
    batchId: z.string().min(1, 'Batch ID is required'),
    temperature: z.number().min(-20).max(60).optional(),
    humidity: z.number().min(0).max(100).optional(),
    daysSinceHarvest: z.number().min(0).optional(),
    coldChainDeviations: z.number().int().min(0).optional(),
});

// ─── Fraud ────────────────────────────────────────────────────────────────────

export const investigateFraudSchema = z.object({
    alertId: z.string().min(1, 'Alert ID is required'),
    action: z.enum(['APPROVE', 'REJECT', 'RESOLVE', 'FALSE_POSITIVE', 'ESCALATE']),
    notes: z.string().optional(),
});

// ─── Consumer ─────────────────────────────────────────────────────────────────

export const consumerChatSchema = z.object({
    batchId: z.string().min(1, 'Batch ID is required'),
    query: z.string().min(1, 'Query is required').max(500, 'Query too long'),
});

// ─── Compliance ───────────────────────────────────────────────────────────────

export const complianceCheckSchema = z.object({
    shipmentId: z.string().min(1, 'Shipment ID is required'),
    country: z.string().min(1, 'Country is required'),
    crop: z.string().optional(),
});

// ─── RAG document upload ──────────────────────────────────────────────────────

export const ragDocumentSchema = z.object({
    title: z.string().min(1),
    source: z.string().min(1),
    jurisdiction: z.string().min(1),
    documentType: z.string().min(1),
    publicationDate: z.string().optional(),
    effectiveDate: z.string().optional(),
    url: z.string().url().optional(),
    content: z.string().min(1),
});
