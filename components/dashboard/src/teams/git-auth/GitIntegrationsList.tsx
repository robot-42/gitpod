/**
 * Copyright (c) 2023 Gitpod GmbH. All rights reserved.
 * Licensed under the GNU Affero General Public License (AGPL).
 * See License.AGPL.txt in the project root for license information.
 */

import { AuthProviderEntry } from "@gitpod/gitpod-protocol";
import { FunctionComponent, useCallback, useState } from "react";
import { ItemsList } from "../../components/ItemsList";
import { useCurrentUser } from "../../user-context";
import { GitIntegrationListItem } from "./GitIntegrationListItem";
import { GitIntegrationModal } from "./GitIntegrationModal";

type Props = {
    providers: AuthProviderEntry[];
};
export const GitIntegrationsList: FunctionComponent<Props> = ({ providers }) => {
    const user = useCurrentUser();
    const [showCreateModal, setShowCreateModal] = useState(false);

    const onCreate = useCallback(() => setShowCreateModal(true), []);

    return (
        <>
            {providers.length === 0 ? (
                <div className="w-full flex h-80 mt-2 rounded-xl bg-gray-100 dark:bg-gray-900">
                    <div className="m-auto text-center">
                        <h3 className="self-center text-gray-500 dark:text-gray-400 mb-4">No Git Integrations</h3>
                        <div className="text-gray-500 mb-6">
                            In addition to the default Git Providers you can authorize
                            <br /> with a self-hosted instance of a provider.
                        </div>
                        <button className="self-center" onClick={onCreate}>
                            New Integration
                        </button>
                    </div>
                </div>
            ) : (
                <>
                    <div className="mt-3 flex mt-0">
                        <button onClick={onCreate} className="ml-2">
                            New Integration
                        </button>
                    </div>

                    <ItemsList className="pt-6">
                        {providers.map((p) => (
                            <GitIntegrationListItem key={p.id} provider={p} />
                        ))}
                    </ItemsList>
                </>
            )}
            {showCreateModal && (
                <GitIntegrationModal
                    // Push this into the modal, why a prop?
                    userId={user?.id || "no-user"}
                    onClose={() => setShowCreateModal(false)}
                />
            )}
        </>
    );
};
