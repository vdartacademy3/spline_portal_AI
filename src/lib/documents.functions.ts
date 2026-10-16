import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BUCKET = "employee-documents";

const uploadSchema = z.object({
  employeeId: z.string().uuid().nullable(),
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(60),
  expiryDate: z.string().nullable(),
  fileName: z.string().min(1).max(200),
  contentType: z.string().min(1).max(120),
  fileBase64: z.string().min(1),
});

function decodeBase64(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Uploads the real file to private storage and records its metadata under the caller's RLS context. */
export const uploadEmployeeDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => uploadSchema.parse(data))
  .handler(async ({ data, context }) => {
    const bytes = decodeBase64(data.fileBase64);
    if (bytes.byteLength > 20 * 1024 * 1024) throw new Error("File is larger than 20MB.");

    if (data.employeeId) {
      const { data: selfEmployeeId } = await context.supabase.rpc("current_employee_id", {
        _user_id: context.userId,
      });
      const isSelf = (selfEmployeeId as string | null) === data.employeeId;
      if (!isSelf) {
        const { data: allowed, error: permError } = await context.supabase.rpc(
          "can_manage_employee",
          {
            _user_id: context.userId,
            _employee_id: data.employeeId,
          },
        );
        if (permError) throw permError;
        if (!allowed) throw new Error("You are not authorized to add documents for this employee.");
      }
    }

    const safeName = data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${data.employeeId ?? "unassigned"}/${Date.now()}-${safeName}`;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: data.contentType, upsert: false });
    if (uploadError) throw uploadError;

    const { data: row, error } = await context.supabase
      .from("employee_documents")
      .insert({
        employee_id: data.employeeId,
        name: data.name,
        category: data.category,
        expiry_date: data.expiryDate,
        file_url: path,
        uploaded_by: context.userId,
      })
      .select("id")
      .single();
    if (error) {
      await supabaseAdmin.storage.from(BUCKET).remove([path]);
      throw error;
    }

    await context.supabase.from("audit_logs").insert({
      user_id: context.userId,
      action: "document.uploaded",
      entity: "employee_documents",
      entity_id: row.id,
      new_value: {
        name: data.name,
        category: data.category,
        employee_id: data.employeeId,
      } as never,
    });

    return { id: row.id as string };
  });

/** Returns a short-lived signed URL, but only for a document the caller is allowed to read. */
export const getDocumentUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    // RLS decides whether this row is visible to the caller.
    const { data: doc, error } = await context.supabase
      .from("employee_documents")
      .select("id, file_url")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!doc?.file_url) throw new Error("No file is stored for this document.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error: signError } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(doc.file_url, 60);
    if (signError) throw signError;
    return { url: signed.signedUrl };
  });
