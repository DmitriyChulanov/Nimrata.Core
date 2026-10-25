import { useAuthContext } from '@platform/auth/useAuthContext';

import type { ApiClient } from '@platform/api/apiClient';

/** API-клиент с access-токеном текущего пользователя */
export function useApi(): ApiClient {
    return useAuthContext().api;
}
