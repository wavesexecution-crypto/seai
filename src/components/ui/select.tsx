import { useEffect, useRef, useState, type KeyboardEvent } from "react";

export interface SelectOption {
  value: string;
  label: string;
}

export interface CustomSelectProps {
  id: string;
  name: string;
  options: SelectOption[];
  defaultValue?: string;
  placeholder?: string;
  onChange?: (value: string) => void;
}

export default function CustomSelect({
  id,
  name,
  options,
  defaultValue = "",
  placeholder = "Select…",
  onChange,
}: CustomSelectProps) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(
    Math.max(0, options.findIndex((o) => o.value === defaultValue)),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey as any);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey as any);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      const idx = options.findIndex((o) => o.value === value);
      setActiveIndex(idx >= 0 ? idx : 0);
      // focus list
      setTimeout(() => listRef.current?.focus(), 0);
    }
  }, [open, options, value]);

  const select = (v: string) => {
    setValue(v);
    setOpen(false);
    triggerRef.current?.focus();
    onChange?.(v);
  };

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
    }
  };

  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const opt = options[activeIndex];
      if (opt) select(opt.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  const selectedLabel = options.find((o) => o.value === value)?.label || placeholder;

  return (
    <div className={`g-select${open ? " open" : ""}`} ref={rootRef}>
      <input type="hidden" name={name} value={value} />
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className="g-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKey}
      >
        <span className="g-select-value">{selectedLabel}</span>
      </button>
      <ul
        id={`${id}-listbox`}
        ref={listRef}
        className="g-select-menu"
        role="listbox"
        tabIndex={-1}
        aria-labelledby={id}
        onKeyDown={onListKey}
      >
        {options.map((opt, idx) => (
          <li
            key={opt.value}
            role="option"
            aria-selected={opt.value === value}
            className={`g-select-option${opt.value === value ? " is-selected" : ""}${idx === activeIndex ? " is-active" : ""}`}
            onClick={() => select(opt.value)}
            onMouseEnter={() => setActiveIndex(idx)}
          >
            {opt.label}
          </li>
        ))}
      </ul>
    </div>
  );
}