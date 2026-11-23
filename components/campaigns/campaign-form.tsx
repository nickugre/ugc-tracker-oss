"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { PlusIcon, Trash2Icon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { Controller, useFieldArray, useForm, useWatch, type FieldPath } from "react-hook-form"
import { toast } from "sonner"

import { IntegerInput, MoneyInput } from "@/components/form/number-inputs"
import { SimpleSelect, type SelectOption } from "@/components/form/simple-select"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { LIVE_PLATFORMS, PLATFORMS, type Platform } from "@/db/schema/enums"
import { saveCampaign } from "@/lib/actions/campaigns"
import { PLATFORM_LABELS } from "@/lib/format"
import { formatCents } from "@/lib/money/cents"
import { TIME_ZONES, timeZoneLabel } from "@/lib/time-zones"
import {
  campaignInputSchema,
  CONTRACT_MILESTONES,
  type CampaignInput,
} from "@/lib/validation/campaign"

const STATUS: SelectOption<CampaignInput["status"]>[] = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "ended", label: "Ended" },
]
const BASE_TYPES: SelectOption<CampaignInput["baseType"]>[] = [
  { value: "none", label: "No base pay" },
  { value: "per_video", label: "Per video" },
  { value: "weekly_retainer", label: "Weekly retainer" },
  { value: "monthly_retainer", label: "Monthly retainer" },
]
const BONUS_TYPES: SelectOption<CampaignInput["bonusType"]>[] = [
  { value: "none", label: "No bonus" },
  { value: "cpm", label: "CPM (per 1,000 views)" },
  { value: "milestone", label: "Milestone ladder" },
  { value: "hybrid", label: "Hybrid (CPM + milestones)" },
]
const MILESTONE_SCOPES: SelectOption<CampaignInput["milestoneScope"]>[] = [
  { value: "creator_cycle_best", label: "Best single video per creator, each cycle" },
  { value: "creator_campaign_lifetime", label: "Best single video per creator, whole campaign" },
  { value: "per_video", label: "Every video earns its own tier (stacking)" },
]
const MILESTONE_SCOPE_HELP: Record<CampaignInput["milestoneScope"], string> = {
  creator_cycle_best:
    "Non-stacking. The creator's best video in the cycle sets the tier; only the highest tier reached is paid. Resets every cycle.",
  creator_campaign_lifetime:
    "Non-stacking across the whole campaign. Reaching a higher tier later pays only the difference.",
  per_video: "Each video is paid the highest tier it reached.",
}
const WEEK_DAYS: SelectOption[] = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
].map((label, i) => ({ value: String(i), label }))

function Section({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="grid gap-x-10 gap-y-5 border-b py-8 first:pt-2 last:border-b-0 lg:grid-cols-[260px_1fr]">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex max-w-2xl flex-col gap-5">{children}</div>
    </section>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-5 sm:grid-cols-2">{children}</div>
}

export function CampaignForm({
  campaignId,
  defaultValues,
}: {
  campaignId: string | null
  defaultValues: CampaignInput
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const form = useForm<CampaignInput>({
    resolver: zodResolver(campaignInputSchema),
    defaultValues,
    mode: "onBlur",
  })
  const { control, register, handleSubmit, setError, setValue, formState } = form
  const errors = formState.errors
  const milestones = useFieldArray({ control, name: "milestones" })

  const v = useWatch({ control })
  const usesCpm = v.bonusType === "cpm" || v.bonusType === "hybrid"
  const usesMilestones = v.bonusType === "milestone" || v.bonusType === "hybrid"
  const isRetainer = v.baseType === "weekly_retainer" || v.baseType === "monthly_retainer"
  const platformCount = v.platforms?.length ?? 0
  const totalQuota =
    v.quotaCount && platformCount
      ? v.quotaScope === "per_platform"
        ? v.quotaCount * platformCount
        : v.quotaCount
      : null
  const perPostCents =
    isRetainer && totalQuota && v.baseAmountCents
      ? Math.round(v.baseAmountCents / totalQuota)
      : v.baseType === "per_video"
        ? (v.baseAmountCents ?? null)
        : null
  const timeZones = v.timezone && !TIME_ZONES.includes(v.timezone) ? [v.timezone, ...TIME_ZONES] : TIME_ZONES

  function onSubmit(values: CampaignInput) {
    startTransition(async () => {
      const result = await saveCampaign({ id: campaignId, input: values })
      if (!result.ok) {
        Object.entries(result.fieldErrors ?? {}).forEach(([path, message]) =>
          setError(path as FieldPath<CampaignInput>, { message })
        )
        toast.error(result.error)
        return
      }
      toast.success(campaignId ? "Campaign saved" : "Campaign created")
      if (!campaignId) router.push(`/campaigns/${result.data.id}`)
    })
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col">
      <Section title="Basics" description="What the campaign is, when it runs and where creators post.">
        <Field data-invalid={Boolean(errors.name)}>
          <FieldLabel htmlFor="name">Name</FieldLabel>
          <Input id="name" placeholder="e.g. Acme UGC — Fall" aria-invalid={Boolean(errors.name)} {...register("name")} />
          <FieldError errors={[errors.name]} />
        </Field>
        <Row>
          <Field>
            <FieldLabel htmlFor="status">Status</FieldLabel>
            <Controller
              control={control}
              name="status"
              render={({ field }) => (
                <SimpleSelect id="status" options={STATUS} value={field.value} onValueChange={(x) => x && field.onChange(x)} />
              )}
            />
          </Field>
          <Field data-invalid={Boolean(errors.timezone)}>
            <FieldLabel htmlFor="timezone">Time zone</FieldLabel>
            <Controller
              control={control}
              name="timezone"
              render={({ field }) => (
                <SimpleSelect
                  id="timezone"
                  options={timeZones.map((tz) => ({ value: tz, label: timeZoneLabel(tz) }))}
                  value={field.value}
                  onValueChange={(x) => x && field.onChange(x)}
                />
              )}
            />
            <FieldDescription>Decides which day and cycle a post belongs to.</FieldDescription>
          </Field>
        </Row>
        <Row>
          <Field data-invalid={Boolean(errors.startDate)}>
            <FieldLabel htmlFor="startDate">Start date</FieldLabel>
            <Input id="startDate" type="date" aria-invalid={Boolean(errors.startDate)} {...register("startDate")} />
            <FieldError errors={[errors.startDate]} />
          </Field>
          <Field data-invalid={Boolean(errors.endDate)}>
            <FieldLabel htmlFor="endDate">End date</FieldLabel>
            <Controller
              control={control}
              name="endDate"
              render={({ field }) => (
                <Input
                  id="endDate"
                  type="date"
                  value={field.value ?? ""}
                  aria-invalid={Boolean(errors.endDate)}
                  onChange={(e) => field.onChange(e.target.value || null)}
                  onBlur={field.onBlur}
                />
              )}
            />
            <FieldDescription>Leave empty for an ongoing campaign.</FieldDescription>
            <FieldError errors={[errors.endDate]} />
          </Field>
        </Row>
        <Field data-invalid={Boolean(errors.platforms)}>
          <FieldLabel>Platforms</FieldLabel>
          <Controller
            control={control}
            name="platforms"
            render={({ field }) => (
              <div className="flex flex-wrap gap-x-6 gap-y-2.5">
                {PLATFORMS.map((platform: Platform) => {
                  const checked = field.value.includes(platform)
                  return (
                    <label key={platform} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(next) =>
                          field.onChange(
                            next
                              ? PLATFORMS.filter((p) => p === platform || field.value.includes(p))
                              : field.value.filter((p) => p !== platform)
                          )
                        }
                      />
                      {PLATFORM_LABELS[platform]}
                      {LIVE_PLATFORMS.includes(platform) ? null : (
                        <span className="text-xs text-muted-foreground">(scraping soon)</span>
                      )}
                    </label>
                  )
                })}
              </div>
            )}
          />
          <FieldError errors={[errors.platforms]} />
        </Field>
      </Section>

      <Section
        title="Posting and view window"
        description="How much creators are expected to post, and for how long a video's organic views count."
      >
        <Field data-invalid={Boolean(errors.quotaCount)}>
          <FieldLabel htmlFor="quotaCount">Posting quota</FieldLabel>
          <div className="grid gap-3 sm:grid-cols-[120px_1fr_1fr]">
            <Controller
              control={control}
              name="quotaCount"
              render={({ field }) => (
                <IntegerInput id="quotaCount" min={1} placeholder="No quota" value={field.value} onChange={field.onChange} aria-invalid={Boolean(errors.quotaCount)} />
              )}
            />
            <Controller
              control={control}
              name="quotaPeriod"
              render={({ field }) => (
                <SimpleSelect
                  options={[
                    { value: "month", label: "videos per month" },
                    { value: "week", label: "videos per week" },
                  ]}
                  value={field.value}
                  onValueChange={(x) => x && field.onChange(x)}
                />
              )}
            />
            <Controller
              control={control}
              name="quotaScope"
              render={({ field }) => (
                <SimpleSelect
                  options={[
                    { value: "per_platform", label: "on each platform" },
                    { value: "total", label: "in total" },
                    { value: "best_platform", label: "cross-posted, best platform counts" },
                  ]}
                  value={field.value}
                  onValueChange={(x) => x && field.onChange(x)}
                />
              )}
            />
          </div>
          <FieldDescription>
            {totalQuota
              ? v.quotaScope === "best_platform"
                ? `${totalQuota} videos per ${v.quotaPeriod} per creator, each posted on every platform. The platform with the most videos sets the count, so ${totalQuota} on one platform and ${Math.floor((totalQuota * 5) / 6)} on another count as ${totalQuota}.${
                    perPostCents ? ` One video is worth ${formatCents(perPostCents)}.` : ""
                  }`
                : `${totalQuota} posts per ${v.quotaPeriod} per creator${
                    v.quotaScope === "per_platform"
                      ? `. Extra posts on one platform do not make up for a shortfall on another.`
                      : "."
                  }${perPostCents ? ` One post is worth ${formatCents(perPostCents)}.` : ""}`
              : "No quota: the base is never pro-rated."}
          </FieldDescription>
          <FieldError errors={[errors.quotaCount]} />
        </Field>
        <Field data-invalid={Boolean(errors.defaultWindowDays)} className="max-w-xs">
          <FieldLabel htmlFor="defaultWindowDays">View window</FieldLabel>
          <div className="flex items-center gap-2">
            <Controller
              control={control}
              name="defaultWindowDays"
              render={({ field }) => (
                <IntegerInput id="defaultWindowDays" min={1} className="w-24" value={field.value} onChange={(x) => field.onChange(x ?? 0)} aria-invalid={Boolean(errors.defaultWindowDays)} />
              )}
            />
            <span className="text-sm text-muted-foreground">days from posting</span>
          </div>
          <FieldDescription>
            Views after the window add no bonus. You can override the window on a single video.
          </FieldDescription>
          <FieldError errors={[errors.defaultWindowDays]} />
        </Field>
      </Section>

      <Section title="Pay structure" description="Base pay for delivering content, plus bonuses on organic views inside the window.">
        <Row>
          <Field>
            <FieldLabel htmlFor="baseType">Base pay</FieldLabel>
            <Controller
              control={control}
              name="baseType"
              render={({ field }) => (
                <SimpleSelect
                  id="baseType"
                  options={BASE_TYPES}
                  value={field.value}
                  onValueChange={(x) => {
                    if (!x) return
                    field.onChange(x)
                    // Retainers are paid per cycle, so keep the cycle in step.
                    if (x === "weekly_retainer") setValue("cycleType", "weekly")
                    if (x === "monthly_retainer") setValue("cycleType", "monthly")
                  }}
                />
              )}
            />
          </Field>
          {v.baseType !== "none" ? (
            <Field data-invalid={Boolean(errors.baseAmountCents)}>
              <FieldLabel htmlFor="baseAmountCents">
                {v.baseType === "per_video" ? "Rate per video" : "Retainer amount"}
              </FieldLabel>
              <Controller
                control={control}
                name="baseAmountCents"
                render={({ field }) => (
                  <MoneyInput id="baseAmountCents" value={field.value} onChange={(x) => field.onChange(x ?? 0)} aria-invalid={Boolean(errors.baseAmountCents)} />
                )}
              />
              <FieldError errors={[errors.baseAmountCents]} />
            </Field>
          ) : null}
        </Row>
        {isRetainer ? (
          <Field orientation="horizontal">
            <Controller
              control={control}
              name="prorateBase"
              render={({ field }) => (
                <Switch id="prorateBase" checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
            <div className="flex flex-col gap-0.5">
              <FieldLabel htmlFor="prorateBase">Pro-rate when the quota is missed</FieldLabel>
              <FieldDescription>
                Posting 112 of 120 videos pays 112/120 of the retainer.
              </FieldDescription>
            </div>
          </Field>
        ) : null}

        <Field className="max-w-sm">
          <FieldLabel htmlFor="bonusType">Performance bonus</FieldLabel>
          <Controller
            control={control}
            name="bonusType"
            render={({ field }) => (
              <SimpleSelect id="bonusType" options={BONUS_TYPES} value={field.value} onValueChange={(x) => x && field.onChange(x)} />
            )}
          />
        </Field>

        {usesCpm ? (
          <>
            <Row>
              <Field data-invalid={Boolean(errors.cpmRateCents)}>
                <FieldLabel htmlFor="cpmRateCents">CPM rate</FieldLabel>
                <Controller
                  control={control}
                  name="cpmRateCents"
                  render={({ field }) => (
                    <MoneyInput id="cpmRateCents" placeholder="3" suffix="per 1,000 views" value={field.value} onChange={field.onChange} aria-invalid={Boolean(errors.cpmRateCents)} />
                  )}
                />
                <FieldError errors={[errors.cpmRateCents]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="minViewsForBonus">Minimum views</FieldLabel>
                <Controller
                  control={control}
                  name="minViewsForBonus"
                  render={({ field }) => (
                    <IntegerInput id="minViewsForBonus" placeholder="No minimum" value={field.value} onChange={field.onChange} />
                  )}
                />
              </Field>
            </Row>
            {v.minViewsForBonus ? (
              <Field className="max-w-sm">
                <FieldLabel htmlFor="cpmMinViewsMode">Once the minimum is reached</FieldLabel>
                <Controller
                  control={control}
                  name="cpmMinViewsMode"
                  render={({ field }) => (
                    <SimpleSelect
                      id="cpmMinViewsMode"
                      options={[
                        { value: "qualify", label: "Pay on all views" },
                        { value: "excess", label: "Pay only on views above the minimum" },
                      ]}
                      value={field.value}
                      onValueChange={(x) => x && field.onChange(x)}
                    />
                  )}
                />
              </Field>
            ) : null}
          </>
        ) : null}

        {usesMilestones ? (
          <Field data-invalid={Boolean(errors.milestones)}>
            <div className="flex items-center justify-between">
              <FieldLabel>Milestone ladder</FieldLabel>
              <Button type="button" variant="ghost" size="sm" onClick={() => milestones.replace(CONTRACT_MILESTONES)}>
                Use 20K – 1M preset
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              {milestones.fields.map((row, index) => (
                <div key={row.id} className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2">
                  <Controller
                    control={control}
                    name={`milestones.${index}.views`}
                    render={({ field }) => (
                      <IntegerInput min={1} placeholder="Views" value={field.value} onChange={(x) => field.onChange(x ?? 0)} aria-invalid={Boolean(errors.milestones?.[index]?.views)} />
                    )}
                  />
                  <span className="text-sm text-muted-foreground">views pays</span>
                  <Controller
                    control={control}
                    name={`milestones.${index}.amountCents`}
                    render={({ field }) => (
                      <MoneyInput value={field.value} onChange={(x) => field.onChange(x ?? 0)} aria-invalid={Boolean(errors.milestones?.[index]?.amountCents)} />
                    )}
                  />
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove milestone" onClick={() => milestones.remove(index)}>
                    <Trash2Icon />
                  </Button>
                </div>
              ))}
              <div>
                <Button type="button" variant="outline" size="sm" onClick={() => milestones.append({ views: 0, amountCents: 0 })}>
                  <PlusIcon />
                  Add milestone
                </Button>
              </div>
            </div>
            <FieldError
              errors={[
                errors.milestones?.root ?? (errors.milestones as { message?: string } | undefined),
                ...(Array.isArray(errors.milestones) ? errors.milestones.map((m) => m?.views ?? m?.amountCents) : []),
              ]}
            />
          </Field>
        ) : null}

        {usesMilestones ? (
          <Field>
            <FieldLabel htmlFor="milestoneScope">How milestones are counted</FieldLabel>
            <Controller
              control={control}
              name="milestoneScope"
              render={({ field }) => (
                <SimpleSelect id="milestoneScope" options={MILESTONE_SCOPES} value={field.value} onValueChange={(x) => x && field.onChange(x)} />
              )}
            />
            <FieldDescription>{v.milestoneScope ? MILESTONE_SCOPE_HELP[v.milestoneScope] : null}</FieldDescription>
          </Field>
        ) : null}

        {v.bonusType !== "none" ? (
          <div className="grid gap-5 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="perVideoBonusCapCents">Per-video bonus cap</FieldLabel>
              <Controller
                control={control}
                name="perVideoBonusCapCents"
                render={({ field }) => (
                  <MoneyInput id="perVideoBonusCapCents" placeholder="No cap" value={field.value} onChange={field.onChange} />
                )}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="perCreatorCycleCapCents">Creator bonus cap / cycle</FieldLabel>
              <Controller
                control={control}
                name="perCreatorCycleCapCents"
                render={({ field }) => (
                  <MoneyInput id="perCreatorCycleCapCents" placeholder="No cap" value={field.value} onChange={field.onChange} />
                )}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="perCreatorCycleTotalCapCents">Creator total cap / cycle</FieldLabel>
              <Controller
                control={control}
                name="perCreatorCycleTotalCapCents"
                render={({ field }) => (
                  <MoneyInput id="perCreatorCycleTotalCapCents" placeholder="No cap" value={field.value} onChange={field.onChange} />
                )}
              />
            </Field>
          </div>
        ) : null}
      </Section>

      <Section title="Payout cycle" description="When videos with a closed window are paid. Videos still in their window roll to the next cycle.">
        <Row>
          <Field data-invalid={Boolean(errors.cycleType)}>
            <FieldLabel htmlFor="cycleType">Cycle</FieldLabel>
            <Controller
              control={control}
              name="cycleType"
              render={({ field }) => (
                <SimpleSelect
                  id="cycleType"
                  options={[
                    { value: "monthly", label: "Monthly (calendar month)" },
                    { value: "weekly", label: "Weekly" },
                  ]}
                  value={field.value}
                  onValueChange={(x) => x && field.onChange(x)}
                  aria-invalid={Boolean(errors.cycleType)}
                />
              )}
            />
            <FieldError errors={[errors.cycleType]} />
          </Field>
          {v.cycleType === "weekly" ? (
            <Field>
              <FieldLabel htmlFor="weekStartsOn">Week starts on</FieldLabel>
              <Controller
                control={control}
                name="weekStartsOn"
                render={({ field }) => (
                  <SimpleSelect id="weekStartsOn" options={WEEK_DAYS} value={String(field.value)} onValueChange={(x) => x && field.onChange(Number(x))} />
                )}
              />
            </Field>
          ) : null}
        </Row>
        <Row>
          <Field>
            <FieldLabel htmlFor="paydayRule">Payday</FieldLabel>
            <Controller
              control={control}
              name="paydayRule"
              render={({ field }) => (
                <SimpleSelect
                  id="paydayRule"
                  options={[
                    { value: "last_day_of_month", label: "Last day of the month" },
                    { value: "end_of_cycle", label: "Last day of the cycle" },
                  ]}
                  value={field.value}
                  onValueChange={(x) => x && field.onChange(x)}
                />
              )}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="currency">Currency</FieldLabel>
            <Input id="currency" value="USD" disabled readOnly />
          </Field>
        </Row>
      </Section>

      <Section title="Usage rights" description="Shown with the campaign so everyone applies the same rule to paid views.">
        <Field data-invalid={Boolean(errors.usageRightsNote)}>
          <FieldLabel htmlFor="usageRightsNote">Note</FieldLabel>
          <Controller
            control={control}
            name="usageRightsNote"
            render={({ field }) => (
              <Textarea id="usageRightsNote" rows={4} value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value || null)} onBlur={field.onBlur} />
            )}
          />
          <FieldError errors={[errors.usageRightsNote]} />
        </Field>
      </Section>

      <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        <Button type="button" variant="ghost" onClick={() => router.push("/campaigns")} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : campaignId ? "Save changes" : "Create campaign"}
        </Button>
      </div>
    </form>
  )
}
