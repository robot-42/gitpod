/**
 * Copyright (c) 2023 Gitpod GmbH. All rights reserved.
 * Licensed under the GNU Affero General Public License (AGPL).
 * See License.AGPL.txt in the project root for license information.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getGitpodService } from "../../service/service";
import { getOwnAuthProvidersQueryKey, OwnAuthProvidersQueryResult } from "./own-auth-providers-query";

type DeleteAuthProviderArgs = {
    providerId: string;
};
export const useDeleteAuthProviderMutation = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ providerId }: DeleteAuthProviderArgs) => {
            return await getGitpodService().server.deleteOwnAuthProvider({ id: providerId });
        },
        onSuccess: (_, { providerId }) => {
            const queryKey = getOwnAuthProvidersQueryKey();
            queryClient.setQueryData<OwnAuthProvidersQueryResult>(queryKey, (providers) => {
                return providers?.filter((p) => p.id !== providerId);
            });

            queryClient.invalidateQueries({ queryKey });
        },
    });
};
