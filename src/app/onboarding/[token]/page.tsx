import { OnboardingClient } from "./onboarding-client";

export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <OnboardingClient token={token} />;
}
