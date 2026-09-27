import { NextResponse } from 'next/server';

/**
 * The envelope every route handler returns.
 *
 * `T` defaults to `unknown`, not `any`. It is only ever *read* by consumers,
 * and `unknown` forces them to narrow — which is the point of a response type.
 * `any` here silently laundered every payload into an unchecked value.
 */
export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: {
        code: string;
        message: string;
    };
}

export function successResponse<T>(data: T, status = 200) {
    return NextResponse.json({ success: true, data }, { status });
}

export function errorResponse(message: string, code = 'BAD_REQUEST', status = 400) {
    return NextResponse.json(
        {
            success: false,
            error: {
                code,
                message,
            },
        },
        { status }
    );
}
