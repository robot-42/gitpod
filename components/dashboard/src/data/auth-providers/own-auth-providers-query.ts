/**
 * Copyright (c) 2023 Gitpod GmbH. All rights reserved.
 * Licensed under the GNU Affero General Public License (AGPL).
 * See License.AGPL.txt in the project root for license information.
 */

import { AuthProviderEntry } from "@gitpod/gitpod-protocol";
import { useQuery } from "@tanstack/react-query";
import { getGitpodService } from "../../service/service";

export type OwnAuthProvidersQueryResult = AuthProviderEntry[];
export const useOwnAuthProvidersQuery = () => {
    return useQuery<OwnAuthProvidersQueryResult>({
        queryKey: getOwnAuthProvidersQueryKey(),
        queryFn: async () => {
            return await getGitpodService().server.getOwnAuthProviders();
        },
    });
};

export const getOwnAuthProvidersQueryKey = () => ["auth-providers", { own: true }];
