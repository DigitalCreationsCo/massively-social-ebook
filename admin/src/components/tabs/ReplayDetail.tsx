import { useSessionReplay } from "@shared/hooks/use-session-replay";
import { Replay } from "@shared/components/Replay";
import { useAdminToken } from "../../hooks/useAdminToken";
import { adminFetch } from "../../api/client";

interface ReplayDetailProps {
  sessionId: number;
  channelId: string;
}

export default function ReplayDetail({
  sessionId,
  channelId,
}: ReplayDetailProps) {
  const { token } = useAdminToken();
  const { session, blocks, isLoading, error } = useSessionReplay({
    channelId,
    requestedSessionId: sessionId,
    notableOnly: false,
  });

  if (isLoading) return <p>Loading replay data...</p>;
  if (error) return <p className="text-red-500">Error: {error.message}</p>;
  if (!session || !blocks) return <p>No replay data found.</p>;

  return (
    <div className="h-full flex flex-col">
      <h2 className="text-lg font-semibold mb-2">{session.title}</h2>
      <div className="flex-1">
        <Replay session={session} blocks={blocks} />
      </div>
      <div className="mt-4">
        <button
          onClick={async () => {
            try {
              const res = await adminFetch<{ message: string; status: string }>(
                `/replays/${sessionId}/render`,
                token,
                { method: "POST" },
              );
              alert(res.message);
            } catch (err) {
              alert(
                "Failed to start rendering: " +
                  (err instanceof Error ? err.message : String(err)),
              );
            }
          }}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
        >
          Download MP4
        </button>
      </div>
    </div>
  );
}
