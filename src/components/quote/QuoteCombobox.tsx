"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { LookupOption } from "@/lib/api/quote-lookups";

export function QuoteCombobox({
  label,
  value,
  placeholder,
  required,
  autoFocus,
  disabled,
  options,
  loading,
  serverFilter,
  error,
  onQuery,
  onSelect,
  onClear,
  onOpen,
}: {
  label: string;
  value: LookupOption | null;
  placeholder: string;
  required?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  options: LookupOption[];
  loading?: boolean;
  serverFilter?: boolean;
  error?: string;
  onQuery: (query: string) => void;
  onSelect: (option: LookupOption) => void;
  onClear: () => void;
  onOpen?: () => void;
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value?.label ?? "");
  const clearable = !required && !disabled;

  useEffect(() => {
    setText(value?.label ?? "");
  }, [value?.id, value?.label]);

  useEffect(() => {
    function onDoc(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={rootRef} className="relative min-w-0">
      {label ? (
        <label htmlFor={id} className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
          {label}
          {required ? <span className="text-red-500"> *</span> : null}
        </label>
      ) : (
        <label htmlFor={id} className="sr-only">
          {placeholder}
        </label>
      )}
      <div
        className={`flex rounded-lg border border-slate-200 ${
          disabled
            ? "bg-slate-50"
            : "bg-white focus-within:border-[#086fb8] focus-within:ring-2 focus-within:ring-[#086fb8]/20"
        }`}
      >
        <input
          id={id}
          autoFocus={autoFocus}
          readOnly={disabled}
          disabled={disabled}
          className={`min-w-0 flex-1 rounded-lg px-3 py-2 text-sm outline-none ${
            disabled ? "cursor-default text-slate-700" : ""
          }`}
          placeholder={placeholder}
          value={text}
          onFocus={() => {
            if (disabled) return;
            setOpen(true);
            onOpen?.();
          }}
          onBlur={() => {
            if (required && value) setText(value.label);
          }}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            setOpen(true);
            if (!next && clearable) onClear();
            onQuery(next);
          }}
        />
        {value && clearable ? (
          <button
            type="button"
            className="px-2 text-slate-400 hover:text-slate-700"
            aria-label={`Clear ${label}`}
            onClick={() => {
              setText("");
              onClear();
              onQuery("");
            }}
          >
            ×
          </button>
        ) : null}
      </div>
      {!disabled && open && (loading || options.length > 0 || text.length > 0) ? (
        <ul className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {loading ? <li className="px-3 py-2 text-sm text-slate-500">Searching…</li> : null}
          {error && !loading ? <li className="px-3 py-2 text-sm text-red-600">{error}</li> : null}
          {!loading && !error && options.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500">No matches</li>
          ) : null}
          {!loading && options.length > 0 ? (
            (serverFilter
              ? options
              : options.filter(
                  (option) =>
                    !text ||
                    option.label.toLowerCase().includes(text.toLowerCase()) ||
                    option.id === value?.id,
                )
            ).map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm hover:bg-sky-50"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onSelect(option);
                    setText(option.label);
                    setOpen(false);
                  }}
                >
                  {option.label}
                </button>
              </li>
            ))
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
