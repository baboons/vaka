import { LibraryView } from "@/components/library-view";

export const dynamic = "force-dynamic";

export const metadata = { title: "TV shows — vaka" };

export default function TvPage() {
  return <LibraryView kind="tv" />;
}
