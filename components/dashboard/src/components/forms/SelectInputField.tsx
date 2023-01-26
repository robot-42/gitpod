/**
 * Copyright (c) 2023 Gitpod GmbH. All rights reserved.
 * Licensed under the GNU Affero General Public License (AGPL).
 * See License.AGPL.txt in the project root for license information.
 */

import classNames from "classnames";
import { FunctionComponent, memo, ReactNode, useCallback } from "react";
import { useId } from "../../hooks/useId";
import { InputField } from "./InputField";

type Props = {
    label: ReactNode;
    value: string;
    id?: string;
    hint?: ReactNode;
    disabled?: boolean;
    required?: boolean;
    onChange: (newValue: string) => void;
};

export const SelectInputField: FunctionComponent<Props> = memo(
    ({ label, value, id, hint, disabled = false, required = false, children, onChange }) => {
        const maybeId = useId();
        const elementId = id || maybeId;

        return (
            <InputField id={elementId} label={label} hint={hint}>
                <SelectInput id={elementId} value={value} onChange={onChange} disabled={disabled} required={required}>
                    {children}
                </SelectInput>
            </InputField>
        );
    },
);

type SelectInputProps = {
    value: string;
    className?: string;
    id?: string;
    disabled?: boolean;
    required?: boolean;
    onChange?: (newValue: string) => void;
};

export const SelectInput: FunctionComponent<SelectInputProps> = memo(
    ({ value, className, id, disabled = false, required = false, children, onChange }) => {
        const handleChange = useCallback(
            (e) => {
                onChange && onChange(e.target.value);
            },
            [onChange],
        );

        return (
            <select
                id={id}
                className={classNames("w-full max-w-lg", className)}
                value={value}
                disabled={disabled}
                required={required}
                onChange={handleChange}
            >
                {children}
            </select>
        );
    },
);
