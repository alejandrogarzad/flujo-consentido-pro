import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { defaultPathFor } from "@/lib/permissions";
import type { AppRole } from "@/types/db";

export default async function HomePage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profile").select("role").eq("id", user.id).maybeSingle();
  const role = (profile?.role as AppRole | undefined) ?? "user";
  redirect(defaultPathFor(role));
}
