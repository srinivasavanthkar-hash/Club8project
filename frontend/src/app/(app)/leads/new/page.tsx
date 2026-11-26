"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { PageHeader } from "@/components/crm/Display";
import { ErrorText, useMaster, useStaff } from "@/components/providers";
import { Alert, Button, Card, Checkbox, Field, Input, Kbd, Select, Textarea } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { Lead } from "@/lib/types";
import { useSaveShortcut } from "@/lib/useShortcut";
import { mobileSchema, optionalMobile } from "@/lib/validation";
import { FormDateField } from "@/components/DateField";

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
  const formRef = useRef<HTMLFormElement>(null);
  const { register, control, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<V>({
    resolver: zodResolver(schema),
    defaultValues: { whatsapp_same_as_mobile: true, email: "" },
    mode: "onTouched",
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
  useSaveShortcut(() => formRef.current?.requestSubmit());
  const dup = err instanceof ApiError && err.code === "ProbableDuplicate";
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-24 sm:pb-0">
      <PageHeader title="New street lead" description="Capture the prospect now; details can be completed at follow-up." />
      <form method="post" ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Card title="Prospect">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Prospect name" htmlFor="n" required error={errors.prospect_name?.message} className="sm:col-span-2">
              <Input id="n" autoComplete="off" autoCapitalize="words" {...register("prospect_name")} />
            </Field>
            <Field label="Mobile" htmlFor="m" required error={errors.mobile?.message} hint="10-digit Indian mobile, or an international number with country code">
              <Input id="m" type="tel" inputMode="tel" autoComplete="off" {...register("mobile")} />
            </Field>
            <Field label="Email" htmlFor="e" error={errors.email?.message}><Input id="e" type="email" inputMode="email" {...register("email")} /></Field>
            <div className="sm:col-span-2">
              <Checkbox label="WhatsApp same as mobile" {...register("whatsapp_same_as_mobile")} />
            </div>
            {!watch("whatsapp_same_as_mobile") && (
              <Field label="WhatsApp" htmlFor="w" error={errors.whatsapp?.message}><Input id="w" inputMode="tel" {...register("whatsapp")} /></Field>
            )}
            <Field label="City" htmlFor="c"><Input id="c" autoCapitalize="words" {...register("city")} /></Field>
          </div>
        </Card>
        <Card title="Source and follow-up">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Street location / sales venue" htmlFor="v">
              <Select id="v" {...register("venue_id")}><option value="">Select…</option>{venues.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
            </Field>
            <Field label="OPC / marketer name" htmlFor="o"><Input id="o" {...register("opc_name")} /></Field>
            <Field label="Assigned salesperson" htmlFor="s">
              <Select id="s" {...register("salesperson_id")}><option value="">Select…</option>{staff.data?.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</Select>
            </Field>
            <Field label="Follow-up date" htmlFor="f"><FormDateField id="f" control={control} name="follow_up_date" /></Field>
            <Field label="Note" htmlFor="note" className="sm:col-span-2"><Textarea id="note" rows={3} {...register("note")} /></Field>
          </div>
        </Card>
        {dup && (
          <Alert kind="warning" title="This looks like an existing record">
            <p className="mb-3">Check the matches below. If this really is a new prospect, give a reason; it is logged.</p>
            <Field label="This looks like an existing record. Reason for saving anyway (logged)" htmlFor="dor">
              <Input id="dor" {...register("duplicate_override_reason")} />
            </Field>
          </Alert>
        )}
        <ErrorText error={err} />
        <div className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-end gap-3 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur sm:static sm:rounded-lg sm:border sm:px-5">
          <span className="mr-auto hidden items-center gap-1 text-sm text-fg-subtle sm:flex"><Kbd>Ctrl</Kbd><Kbd>S</Kbd> to save</span>
          <Button variant="ghost" onClick={() => router.back()}>Cancel</Button>
          <Button type="submit" disabled={isSubmitting} className="min-w-32">{isSubmitting ? "Saving…" : "Save lead"}</Button>
        </div>
      </form>
    </div>
  );
}
