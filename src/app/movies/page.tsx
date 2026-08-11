import { LibraryView } from "@/components/library-view";

export const dynamic = "force-dynamic";

export const metadata = { title: "Movies — tvarr" };

export default function MoviesPage() {
  return <LibraryView kind="movie" />;
}
