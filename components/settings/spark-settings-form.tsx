"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Textarea } from "@/components/ui/textarea"
import { saveSparkSettings } from "@/lib/actions/spark"
import { DEFAULT_KEYWORDS } from "@/lib/spark/keywords"
import type { SparkRules } from "@/lib/spark/suggest"

// "12,5" and "12.5" both mean twelve and a half; anything else that is not a number is NaN.
const toNumber = (text: string) => (text.trim() === "" ? Number.NaN : Number(text.trim().replace(",", ".")))

// Rounds away float noise: 0.07 * 100 is 7.000000000000001.
const percentText = (ratio: number) => String(Math.round(ratio * 10000) / 100)

export function SparkSettingsForm({ rules }: { rules: SparkRules }) {
  const [pending, startTransition] = useTransition()
  const [keywords, setKeywords] = useState(rules.keywords.join("\n"))
  const [engagement, setEngagement] = useState(percentText(rules.minEngagement))
  const [views, setViews] = useState(String(rules.minViews))
  const [appComments, setAppComments] = useState(String(rules.minAppComments))
  const [budget, setBudget] = useState(String(rules.commentsBudgetUsd))
  const [errors, setErrors] = useState<Record<string, string>>({})

  function number(
    key: string,
    label: string,
    value: string,
    onChange: (next: string) => void,
    options: { prefix?: string; suffix?: string; hint: string }
  ) {
    return (
      <Field data-invalid={Boolean(errors[key])}>
        <FieldLabel htmlFor={`spark-${key}`}>{label}</FieldLabel>
        <InputGroup>
          {options.prefix ? (
            <InputGroupAddon>
              <InputGroupText>{options.prefix}</InputGroupText>
            </InputGroupAddon>
          ) : null}
          <InputGroupInput
            id={`spark-${key}`}
            inputMode="decimal"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={Boolean(errors[key])}
          />
          {options.suffix ? (
            <InputGroupAddon align="inline-end">
              <InputGroupText>{options.suffix}</InputGroupText>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
        {errors[key] ? <FieldError>{errors[key]}</FieldError> : <FieldDescription>{options.hint}</FieldDescription>}
      </Field>
    )
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault()
        startTransition(async () => {
          const result = await saveSparkSettings({
            keywordsText: keywords,
            minEngagementPercent: toNumber(engagement),
            minViews: toNumber(views),
            minAppComments: toNumber(appComments),
            commentsBudgetUsd: toNumber(budget),
          })
          if (!result.ok) {
            setErrors(result.fieldErrors ?? {})
            toast.error(result.error)
            return
          }
          setErrors({})
          toast.success(`Saved. ${result.data.keywords} keywords; the Spark page uses them right away.`)
        })
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {number("minEngagementPercent", "Engagement of at least", engagement, setEngagement, {
          suffix: "%",
          hint: "Likes, comments, shares and saves per view.",
        })}
        {number("minAppComments", "Or comments about the app, at least", appComments, setAppComments, {
          hint: "Enough on its own, whatever the engagement.",
        })}
        {number("minViews", "Only videos with views of at least", views, setViews, {
          hint: "Also the bar for having comments read.",
        })}
        {number("commentsBudgetUsd", "Reading comments may cost", budget, setBudget, {
          prefix: "$",
          suffix: "per month",
          hint: "About 4¢ per video. Part of the Apify budget above; 0 switches it off.",
        })}
      </div>

      <Field data-invalid={Boolean(errors.keywordsText)}>
        <FieldLabel htmlFor="spark-keywords">A comment is about the app when it contains</FieldLabel>
        <Textarea
          id="spark-keywords"
          rows={8}
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          className="max-h-56 font-mono text-xs"
          aria-invalid={Boolean(errors.keywordsText)}
        />
        {errors.keywordsText ? <FieldError>{errors.keywordsText}</FieldError> : null}
        <FieldDescription>
          One word or phrase per line. Whole words only: “app” finds “what app?” but not “happy”. Capital letters,
          punctuation and apostrophes do not matter. Add your brand name and the ways people misspell it.
        </FieldDescription>
      </Field>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="text-muted-foreground"
          onClick={() => setKeywords(DEFAULT_KEYWORDS.join("\n"))}
        >
          Restore the default keywords
        </Button>
      </div>
    </form>
  )
}
