/**
 * Copyright (c) 2023 Gitpod GmbH. All rights reserved.
 * Licensed under the GNU Affero General Public License (AGPL).
 * See License.AGPL.txt in the project root for license information.
 */

import { AuthProviderEntry } from "@gitpod/gitpod-protocol";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getGitpodService } from "../../service/service";
import { getOwnAuthProvidersQueryKey } from "./own-auth-providers-query";

type UpsertAuthProviderArgs = {
    provider: AuthProviderEntry.NewEntry | AuthProviderEntry.UpdateEntry;
};
export const useUpsertAuthProviderMutation = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ provider }: UpsertAuthProviderArgs) => {
            return await getGitpodService().server.updateOwnAuthProvider({ entry: provider });
        },
        onSuccess() {
            queryClient.invalidateQueries({ queryKey: getOwnAuthProvidersQueryKey() });
        },
    });
};
