import { LibraryView } from "@/components/library-view";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sports — tvarr" };

export default function SportsPage() {
  return <LibraryView kind="sport" />;
}
