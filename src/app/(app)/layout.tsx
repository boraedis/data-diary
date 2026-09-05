import { TopNav } from "@/components/top-nav";
import { NavigationBlockerProvider } from "@/components/navigation-blocker";

// Wraps every authenticated page (home/day/manage/charts/profile) — a route
// group, so it changes no URLs and needs no proxy.ts update (that matches
// on pathname). The public landing pages live outside this group and don't
// get the nav; see AGENTS.md's public-landing-page section.
//
// NavigationBlockerProvider (issue #143) lives here rather than on
// individual entry pages so TopNav/DayNav can check it regardless of which
// page is currently dirty — see navigation-blocker.tsx.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <NavigationBlockerProvider>
      <TopNav />
      {children}
    </NavigationBlockerProvider>
  );
}
