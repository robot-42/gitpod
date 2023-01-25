/**
 * Copyright (c) 2023 Gitpod GmbH. All rights reserved.
 * Licensed under the GNU Affero General Public License (AGPL).
 * See License.AGPL.txt in the project root for license information.
 */

import { FunctionComponent, memo, ReactNode } from "react";

type Props = {
    label: string;
    id?: string;
    hint?: ReactNode;
};

export const InputField: FunctionComponent<Props> = memo(({ label, id, hint, children }) => {
    return (
        <div className="mt-4 flex flex-col space-y-2">
            <label className="text-sm font-semibold text-gray-600 dark:text-gray-400" htmlFor={id}>
                {label}
            </label>
            {children}
            {hint && <span className="text-gray-500 text-sm">{hint}</span>}
        </div>
    );
});
