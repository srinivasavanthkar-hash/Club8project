"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ErrorText, useMaster, useStaff } from "@/components/providers";
import { Alert, Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { Lead } from "@/lib/types";
import { mobileSchema, optionalMobile } from "@/lib/validation";

const schema = z.object({
  prospect_name: z.string().trim().min(2, "Name is required"),
  mobile: mobileSchema,
  whatsapp_same_as_mobile: z.boolean(),
  whatsapp: optionalMobile,
  email: z.union([z.literal(""), z.string().email("Invalid email")]),
  city: z.string().optional(),
  venue_id: z.string().optional(),
  opc_name: z.string().optional(),
  salesperson_id: z.string().optional(),
  follow_up_date: z.string().optional(),
  note: z.string().optional(),
  duplicate_override_reason: z.string().optional(),
});
type V = z.infer<typeof schema>;

export default function NewLeadPage() {
  const router = useRouter();
  const venues = useMaster("venues");
  const staff = useStaff();
  const [err, setErr] = useState<unknown>(null);
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<V>({
    resolver: zodResolver(schema),
    defaultValues: { whatsapp_same_as_mobile: true, email: "" },
  });
  const onSubmit = handleSubmit(async (v) => {
    setErr(null);
    try {
      const body = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === "" ? null : x]));
      const lead = await api.post<Lead>("/leads", body);
      router.push(`/leads/${lead.id}`);
    } catch (e) {
      setErr(e);
    }
  });
  const dup = err instanceof ApiError && err.code === "ProbableDuplicate";
  return (
    <Card title="New street lead" className="max-w-3xl">
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3 md:grid-cols-2" noValidate>
        <Field label="Prospect name" htmlFor="n" error={errors.prospect_name?.message}><Input id="n" {...register("prospect_name")} /></Field>
        <Field label="Mobile" htmlFor="m" error={errors.mobile?.message}><Input id="m" inputMode="tel" {...register("mobile")} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register("whatsapp_same_as_mobile")} /> WhatsApp same as mobile</label>
        {!watch("whatsapp_same_as_mobile") && (
          <Field label="WhatsApp" htmlFor="w" error={errors.whatsapp?.message}><Input id="w" inputMode="tel" {...register("whatsapp")} /></Field>
        )}
        <Field label="Email" htmlFor="e" error={errors.email?.message}><Input id="e" type="email" {...register("email")} /></Field>
        <Field label="City" htmlFor="c"><Input id="c" {...register("city")} /></Field>
        <Field label="Street location / sales venue" htmlFor="v">
          <Select id="v" {...register("venue_id")}><option value="">Select…</option>{venues.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
        </Field>
        <Field label="OPC / marketer name" htmlFor="o"><Input id="o" {...register("opc_name")} /></Field>
        <Field label="Assigned salesperson" htmlFor="s">
          <Select id="s" {...register("salesperson_id")}><option value="">Select…</option>{staff.data?.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</Select>
        </Field>
        <Field label="Follow-up date" htmlFor="f"><Input id="f" type="date" {...register("follow_up_date")} /></Field>
        <Field label="Note" htmlFor="note" className="md:col-span-2"><Textarea id="note" {...register("note")} /></Field>
        {dup && (
          <Alert kind="warning">
            <Field label="This looks like an existing record. Reason for saving anyway (logged)" htmlFor="dor">
              <Input id="dor" {...register("duplicate_override_reason")} />
            </Field>
          </Alert>
        )}
        <div className="md:col-span-2"><ErrorText error={err} /></div>
        <div className="md:col-span-2 flex justify-end"><Button type="submit" disabled={isSubmitting}>Save lead</Button></div>
      </form>
    </Card>
  );
}
