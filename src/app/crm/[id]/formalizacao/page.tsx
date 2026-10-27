import { AppShell } from "@/components/layout/app-shell";
import { CommercialJourneyPanel } from "@/components/commercial/journey-panel";
export default async function JourneyPage({params}:{params:Promise<{id:string}>}) { const {id}=await params; return <AppShell><CommercialJourneyPanel opportunity={id}/></AppShell>; }
