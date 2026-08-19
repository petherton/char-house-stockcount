import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: staff } = await supabase
    .from("staff_allowlist")
    .select("email")
    .eq("email", user.email)
    .maybeSingle();

  if (!staff) {
    redirect("/not-authorized");
  }

  redirect("/scan/bottle-shop");
}
