import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ScanApp from "@/components/ScanApp";

export default async function ScanPage({
  params,
}: {
  params: { venueId: string };
}) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: staff } = await supabase
    .from("staff_allowlist")
    .select("email")
    .eq("email", user.email)
    .maybeSingle();
  if (!staff) redirect("/not-authorized");

  const { data: venue } = await supabase
    .from("venues")
    .select("id, name")
    .eq("id", params.venueId)
    .maybeSingle();

  if (!venue) redirect("/scan/bottle-shop");

  const { data: allVenues } = await supabase
    .from("venues")
    .select("id, name")
    .order("name");

  return (
    <ScanApp
      venueId={venue.id}
      venueName={venue.name}
      userEmail={user.email!}
      venues={allVenues ?? []}
    />
  );
}
