import { z } from "zod"

import { isValidTimeZone } from "@/lib/time-zones"

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()

export const creatorInputSchema = z.object({
  name: z.string().trim().min(1, "Enter the creator's name").max(120),
  email: z
    .string()
    .trim()
    .max(200)
    .transform((v) => (v === "" ? null : v.toLowerCase()))
    .nullable()
    .refine((v) => v === null || z.email().safeParse(v).success, "Enter a valid email address"),
  phone: optionalText(60),
  contactHandle: optionalText(120),
  country: optionalText(80),
  // "" / null = count the creator's posting days in the campaign's time zone.
  timezone: optionalText(64).refine((v) => v === null || isValidTimeZone(v), "Unknown time zone"),
  paymentDetails: optionalText(500),
  status: z.enum(["active", "paused", "ended"]),
  notes: optionalText(2000),
})

export type CreatorInput = z.infer<typeof creatorInputSchema>
