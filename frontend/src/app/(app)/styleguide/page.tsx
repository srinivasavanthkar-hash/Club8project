import { Styleguide } from "./Styleguide";

// Available in non-production environments, or to ADMIN users in production (checked client-side in <Styleguide>;
// the page contains no data from the API, only fictitious examples).
export const dynamic = "force-dynamic";

export default function StyleguidePage() {
  return <Styleguide production={process.env.CRM_ENV === "prod"} />;
}
