import { EmptyState } from "@/components/EmptyState";
export const metadata = { title: "Slips" };
export default function Slips() {
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Slips</h1>
      <EmptyState title="Slip workshop arrives in phase 4"
        body="For now, build a blend on the Blend scanner: it shows the combined model probability, fair odds and copies the slip as text. Saved slips, optimise, split and merge come next."
        action={{ href: "/scanner/blend", label: "Open the Blend builder" }} />
    </>
  );
}
