import { EmptyState } from "@/components/EmptyState";
export default function NotFound() {
  return <EmptyState title="Not found" body="That fixture or league isn’t in the current data set." action={{ href: "/", label: "Back to today" }} />;
}
