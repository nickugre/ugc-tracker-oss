"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export type SelectOption<V extends string = string> = { value: V; label: string }

// Value used for the "no selection" row, because a Select item cannot carry null.
const NONE = "__none__"

// Thin wrapper over the Base UI select. It passes `items` to the root so the trigger shows the
// option's label (Base UI would otherwise print the raw value), and it maps an optional
// "none" row to null.
export function SimpleSelect<V extends string>({
  value,
  onValueChange,
  options,
  placeholder = "Select…",
  noneLabel,
  id,
  name,
  disabled,
  size,
  className,
  "aria-invalid": ariaInvalid,
}: {
  value: V | null
  onValueChange: (value: V | null) => void
  options: SelectOption<V>[]
  placeholder?: string
  // When set, adds a first row that clears the selection.
  noneLabel?: string
  id?: string
  name?: string
  disabled?: boolean
  size?: "sm" | "default"
  className?: string
  "aria-invalid"?: boolean
}) {
  const items: SelectOption[] = noneLabel
    ? [{ value: NONE, label: noneLabel }, ...options]
    : options

  return (
    <Select
      items={items}
      value={value ?? (noneLabel ? NONE : null)}
      onValueChange={(next) => onValueChange(next === NONE || next == null ? null : (next as V))}
      name={name}
      disabled={disabled}
    >
      <SelectTrigger id={id} size={size} className={className} aria-invalid={ariaInvalid}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {items.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
