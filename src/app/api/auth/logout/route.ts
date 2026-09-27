import { TOKEN_NAME } from '@/lib/auth';
import { successResponse } from '@/lib/response';

export async function POST() {
    const response = successResponse({ message: 'Logged out successfully' });
    response.cookies.delete(TOKEN_NAME);
    return response;
}
