import { connectToDatabase } from '../connection';
import {
    CertificateModel,
    ProductModel,
    type BatchDoc,
    type CertificateDoc,
    type ProductDoc,
} from '../models';

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── PRODUCTS ─────────────────────────────────────────────────────────────────

/**
 * Exact, case-insensitive product lookup.
 *
 * The Prisma call was `{ name: { equals: crop, mode: 'insensitive' } }` on a
 * `@unique` column. A collation cannot be combined with `$regex` in one
 * Mongoose query, and here the column is unique, so a case-insensitive regex
 * that must match the whole string is both simpler and exactly equivalent:
 * on a unique field at most one row can match, which is what `findFirst` on a
 * unique field already assumed.
 */
export async function findProductByNameInsensitive(name: string): Promise<ProductDoc | null> {
    await connectToDatabase();
    return ProductModel.findOne({
        name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' },
    })
        .lean<ProductDoc>()
        .exec();
}

export async function findProductById(id: string): Promise<ProductDoc | null> {
    await connectToDatabase();
    return ProductModel.findById(id).lean<ProductDoc>().exec();
}

/** Just the product's name — for callers that never read the rest. */
export async function findProductNameById(id: string): Promise<string | null> {
    await connectToDatabase();
    const product = await ProductModel.findById(id)
        .select({ name: 1 })
        .lean<{ name: string }>()
        .exec();
    return product?.name ?? null;
}

export interface CreateProductInput {
    name: string;
    category: string;
    description: string;
}

export async function createProduct(input: CreateProductInput): Promise<ProductDoc> {
    await connectToDatabase();
    const product = await ProductModel.create(input);
    return product.toObject() as ProductDoc;
}

// ─── CERTIFICATES ─────────────────────────────────────────────────────────────

export interface CreateCertificateInput {
    batchId: string;
    certificateType: string;
    fileUrl?: string;
    ipfsHash?: string | null;
    fileHash: string;
    issuer: string;
    issueDate?: Date;
    expiryDate: Date;
    verificationStatus?: string;
    blockchainHash?: string | null;
}

export async function createCertificate(input: CreateCertificateInput): Promise<CertificateDoc> {
    await connectToDatabase();
    const certificate = await CertificateModel.create({
        ...input,
        fileUrl: input.fileUrl ?? '',
        issueDate: input.issueDate ?? new Date(),
        verificationStatus: input.verificationStatus ?? 'PENDING',
        ipfsHash: input.ipfsHash ?? null,
        blockchainHash: input.blockchainHash ?? null,
    });
    return certificate.toObject() as CertificateDoc;
}

/** Certificates awaiting an official review, paired with their batch code. */
export async function listPendingCertificates(limit = 100) {
    await connectToDatabase();
    const certificates = await CertificateModel.find({ verificationStatus: 'PENDING' })
        .sort({ createdAt: 1 }).limit(limit).lean<CertificateDoc[]>().exec();
    if (!certificates.length) return [];
    const { BatchModel } = await import('../models');
    const batches = await BatchModel.find({ _id: { $in: [...new Set(certificates.map((c) => c.batchId))] } })
        .select({ _id: 1, batchCode: 1, farmerId: 1 }).lean<Array<{ _id: string; batchCode: string; farmerId: string }>>().exec();
    const byId = new Map(batches.map((b) => [b._id, b]));
    return certificates.map((certificate) => ({ ...certificate, batch: byId.get(certificate.batchId) ?? null }));
}

export async function reviewCertificate(id: string, status: 'VERIFIED' | 'REJECTED', reviewerId: string, notes: string) {
    await connectToDatabase();
    return CertificateModel.findOneAndUpdate(
        { _id: id, verificationStatus: 'PENDING' },
        { $set: { verificationStatus: status, reviewedBy: reviewerId, reviewedAt: new Date(), reviewNotes: notes } },
        { new: true },
    ).lean<CertificateDoc>().exec();
}

/**
 * A certificate on *another* batch with the same content hash.
 *
 * The fraud scanner uses this to catch one certificate being reused across two
 * batches. The `batchId` exclusion is what makes it a duplicate rather than the
 * certificate itself, and the related batch is returned because the alert
 * message names its `batchCode`.
 *
 * In Prisma this was `findFirst` with a nested `include: { batch: true }`; here
 * the certificate is found first and its batch read separately.
 */
export async function findDuplicateCertificate(
    fileHash: string,
    excludeBatchId: string
): Promise<{ certificate: CertificateDoc; batch: BatchDoc } | null> {
    await connectToDatabase();
    const certificate = await CertificateModel.findOne({
        fileHash,
        batchId: { $ne: excludeBatchId },
    })
        .lean<CertificateDoc>()
        .exec();
    if (!certificate) return null;

    const { BatchModel } = await import('../models');
    const batch = await BatchModel.findById(certificate.batchId).lean<BatchDoc>().exec();
    if (!batch) return null;

    return { certificate, batch };
}
