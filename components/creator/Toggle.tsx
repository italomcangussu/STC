import React from 'react';

interface Props {
    id: string;
    label: string;
    checked: boolean;
    onChange: (value: boolean) => void;
}

export const Toggle: React.FC<Props> = ({ id, label, checked, onChange }) => (
    <label htmlFor={id} className="flex items-center gap-3 p-3 bg-stone-50 rounded-xl cursor-pointer">
        <input
            id={id}
            type="checkbox"
            checked={checked}
            onChange={e => onChange(e.target.checked)}
            className="w-5 h-5 accent-saibro-500"
        />
        <span className="text-sm font-medium text-stone-700">{label}</span>
    </label>
);
