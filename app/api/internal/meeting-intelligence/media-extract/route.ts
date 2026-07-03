import { handleInternalMeetingMediaExtract } from "@/lib/meeting-intelligence/internal-media-extract-route";

export async function POST(request: Request) {
  return handleInternalMeetingMediaExtract(request);
}
