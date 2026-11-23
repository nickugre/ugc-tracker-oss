"use client"

import { useState } from "react"

import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import { parseMoneyToCents } from "@/lib/money/cents"

function centsToText(cents: number | null) {
  if (cents == null) return ""
  const whole = Math.trunc(cents / 100)
  const rest = Math.abs(cents % 100)
  return rest === 0 ? String(whole) : `${whole}.${String(rest).padStart(2, "0")}`
}

// Dollar field backed by integer cents. It keeps the text the user typed, and reports cents
// (or null when empty / not a valid amount) so no float maths ever touches money.
export function MoneyInput({
  value,
  onChange,
  id,
  placeholder = "0",
  disabled,
  suffix,
  "aria-invalid": ariaInvalid,
}: {
  value: number | null
  onChange: (cents: number | null) => void
  id?: string
  placeholder?: string
  disabled?: boolean
  suffix?: string
  "aria-invalid"?: boolean
}) {
  const [text, setText] = useState(() => centsToText(value))
  const [lastValue, setLastValue] = useState(value)

  // Resync when the parent replaces the value (e.g. a preset), but not while typing.
  if (value !== lastValue) {
    setLastValue(value)
    if (parseMoneyToCents(text) !== value) setText(centsToText(value))
  }

  const invalid = text.trim() !== "" && parseMoneyToCents(text) === null

  return (
    <InputGroup>
      <InputGroupAddon>
        <InputGroupText>$</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput
        id={id}
        inputMode="decimal"
        placeholder={placeholder}
        disabled={disabled}
        value={text}
        aria-invalid={ariaInvalid || invalid}
        className="tabular-nums"
        onChange={(event) => {
          const next = event.target.value
          setText(next)
          const cents = next.trim() === "" ? null : parseMoneyToCents(next)
          setLastValue(cents)
          onChange(cents)
        }}
      />
      {suffix ? (
        <InputGroupAddon align="inline-end">
          <InputGroupText>{suffix}</InputGroupText>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  )
}

// Whole-number field (views, days, counts). Accepts "20,000" or "20k"-free plain digits.
export function IntegerInput({
  value,
  onChange,
  id,
  placeholder,
  disabled,
  min = 0,
  className,
  "aria-invalid": ariaInvalid,
}: {
  value: number | null
  onChange: (value: number | null) => void
  id?: string
  placeholder?: string
  disabled?: boolean
  min?: number
  className?: string
  "aria-invalid"?: boolean
}) {
  const [text, setText] = useState(() => (value == null ? "" : String(value)))
  const [lastValue, setLastValue] = useState(value)

  if (value !== lastValue) {
    setLastValue(value)
    if (parseInteger(text, min) !== value) setText(value == null ? "" : String(value))
  }

  const invalid = text.trim() !== "" && parseInteger(text, min) === null

  return (
    <Input
      id={id}
      inputMode="numeric"
      placeholder={placeholder}
      disabled={disabled}
      value={text}
      aria-invalid={ariaInvalid || invalid}
      className={`tabular-nums ${className ?? ""}`}
      onChange={(event) => {
        const next = event.target.value
        setText(next)
        const parsed = next.trim() === "" ? null : parseInteger(next, min)
        setLastValue(parsed)
        onChange(parsed)
      }}
    />
  )
}

function parseInteger(text: string, min: number): number | null {
  const cleaned = text.trim().replaceAll(",", "")
  if (!/^\d{1,12}$/.test(cleaned)) return null
  const n = Number(cleaned)
  return n >= min ? n : null
}
