import { Harness } from "@/components/harness/Harness";

// Local UI harness — matches the stitch design (Scenario Builder +
// Optimization Results). The harness is the developer-side surface for
// testing scenarios without curl. The production API is unaffected; the
// page posts to /optimize-energy through fetch only.
export default function Home() {
  return <Harness />;
}