import { connectToDatabase } from '../connection';
import { FarmerProfileModel, UserModel, type FarmerProfileDoc, type UserDoc } from '../models';

/**
 * User and farmer-profile reads and writes.
 *
 * Every function returns lean plain objects. Mongoose documents carry internal
 * state that serialises badly and that no call site wants; the previous Prisma
 * code returned plain objects and the JSON responses depend on that.
 */

export interface UserWithProfile extends UserDoc {
    farmerProfile: FarmerProfileDoc | null;
}

export async function findUserById(id: string): Promise<UserDoc | null> {
    await connectToDatabase();
    return UserModel.findById(id).lean<UserDoc>().exec();
}

export async function findUserByEmail(email: string): Promise<UserDoc | null> {
    await connectToDatabase();
    return UserModel.findOne({ email }).lean<UserDoc>().exec();
}

export async function findUserByIdWithProfile(id: string): Promise<UserWithProfile | null> {
    await connectToDatabase();
    const user = await UserModel.findById(id).lean<UserDoc>().exec();
    if (!user) return null;
    const farmerProfile = await FarmerProfileModel.findOne({ userId: id })
        .lean<FarmerProfileDoc>()
        .exec();
    return { ...user, farmerProfile };
}

/** The same, minus the bcrypt hash. Use for anything that crosses the wire. */
export async function findUserByIdWithProfileSafe(id: string): Promise<UserWithProfile | null> {
    await connectToDatabase();
    const user = await UserModel.findById(id)
        .select('-password')
        .lean<UserDoc>()
        .exec();
    if (!user) return null;
    const farmerProfile = await FarmerProfileModel.findOne({ userId: id })
        .lean<FarmerProfileDoc>()
        .exec();
    return { ...user, farmerProfile };
}

export async function findAllUsers(): Promise<UserDoc[]> {
    await connectToDatabase();
    return UserModel.find({}).sort({ createdAt: -1 }).lean<UserDoc[]>().exec();
}

export interface CreateUserInput {
    name: string;
    email: string;
    password: string;
    role: string;
    phone?: string | null;
}

export interface CreateUserWithProfileInput extends CreateUserInput {
    farmerProfile: {
        farmName: string;
        location: string;
        state: string;
        district: string;
    };
}

/**
 * Create a user and their farmer profile.
 *
 * The Prisma version did this as a nested `farmerProfile: { create: {...} }`
 * inside a single implicit transaction, so a failure left neither row. Mongoose
 * has no implicit transaction, and this is the one write in the app where that
 * difference is user-visible — a half-registered farmer is worse than a
 * failed one. So unlike the other multi-write flows in this codebase (which
 * were already non-atomic and stay that way), this one runs in an explicit
 * transaction and rolls back on failure.
 */
export async function createUserWithProfile(
    input: CreateUserWithProfileInput
): Promise<UserWithProfile> {
    const mongoose = await connectToDatabase();
    const session = await mongoose.startSession();
    try {
        let created: UserDoc | null = null;
        let profile: FarmerProfileDoc | null = null;
        await session.withTransaction(async () => {
            const [user] = await UserModel.create(
                [
                    {
                        name: input.name,
                        email: input.email,
                        password: input.password,
                        role: input.role,
                        phone: input.phone ?? null,
                    },
                ],
                { session }
            );
            created = user.toObject() as UserDoc;

            const [fp] = await FarmerProfileModel.create(
                [
                    {
                        userId: user._id as string,
                        ...input.farmerProfile,
                    },
                ],
                { session }
            );
            profile = fp.toObject() as FarmerProfileDoc;
        });
        return { ...(created as UserDoc), farmerProfile: profile as FarmerProfileDoc };
    } finally {
        await session.endSession();
    }
}

export async function createUser(input: CreateUserInput): Promise<UserDoc> {
    await connectToDatabase();
    const user = await UserModel.create(input);
    return user.toObject() as UserDoc;
}
