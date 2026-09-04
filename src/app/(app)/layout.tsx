import { TopNav } from "@/components/top-nav";

// Wraps every authenticated page (home/day/manage/charts/profile) — a route
// group, so it changes no URLs and needs no proxy.ts update (that matches
// on pathname). The public landing pages live outside this group and don't
// get the nav; see AGENTS.md's public-landing-page section.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TopNav />
      {children}
    </>
  );
}
