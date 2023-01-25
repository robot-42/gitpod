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
    type?: "text" | "password";
    label: string;
    value: string;
    id?: string;
    hint?: ReactNode;
    placeholder?: string;
    disabled?: boolean;
    required?: boolean;
    onChange: (newValue: string) => void;
};

export const TextInputField: FunctionComponent<Props> = memo(
    ({ type = "text", label, value, id, placeholder, hint, disabled = false, required = false, onChange }) => {
        const maybeId = useId();
        const elementId = id || maybeId;

        return (
            <InputField id={elementId} label={label} hint={hint}>
                <TextInput
                    id={elementId}
                    value={value}
                    onChange={onChange}
                    type={type}
                    placeholder={placeholder}
                    disabled={disabled}
                    required={required}
                />
            </InputField>
        );
    },
);

type TextInputProps = {
    type?: "text" | "password";
    value: string;
    className?: string;
    id?: string;
    placeholder?: string;
    disabled?: boolean;
    required?: boolean;
    onChange: (newValue: string) => void;
};

export const TextInput: FunctionComponent<TextInputProps> = memo(
    ({ type = "text", value, className, id, placeholder, disabled = false, required = false, onChange }) => {
        const handleChange = useCallback(
            (e) => {
                onChange(e.target.value);
            },
            [onChange],
        );

        return (
            <input
                id={id}
                className={classNames("w-full max-w-lg", className)}
                value={value}
                onChange={handleChange}
                type={type}
                placeholder={placeholder}
                disabled={disabled}
                required={required}
            />
        );
    },
);
