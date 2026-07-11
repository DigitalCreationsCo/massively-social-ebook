import { useState, useRef } from "react";
import { useSessionReplay } from "@shared/hooks/use-session-replay";
import { Replay, type ReplayHandle } from "@shared/components/Replay";

interface ReplayDetailProps {
  sessionId: number;
  channelId: string;
}

type RenderStatus =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "success"; message: string }
  | { type: "error"; message: string };

export default function ReplayDetail({
  sessionId,
  channelId,
}: ReplayDetailProps) {
  const replayRef = useRef<ReplayHandle>(null);
  const { session, blocks, isLoading, error } = useSessionReplay({
    channelId,
    requestedSessionId: sessionId,
    notableOnly: false,
    tailFocus: {
      numBlocks: 100,
      startPercent: 70,
      direction: "end"
    },
  });
  const [renderStatus, setRenderStatus] = useState<RenderStatus>({
    type: "idle",
  });

  if (isLoading) return <p>Loading replay data...</p>;
  if (error)
    return (
      <div className="text-red-500">
        <p>Failed to load replay data.</p>
        <p className="text-sm text-gray-500 mt-1">
          Session: {sessionId} | Channel: {channelId}
        </p>
        <p className="text-sm mt-1">{error.message}</p>
      </div>
    );
  if (!session || !blocks) return <p>No replay data found.</p>;

  const handleDownload = async () => {
    setRenderStatus({ type: "loading" });
    try {
      await replayRef.current?.downloadVideo();
      setRenderStatus({
        type: "success",
        message: "Video downloaded successfully",
      });
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : String(err);
      console.error("[ReplayDetail] Video capture failed:", err, {
        sessionId,
        channelId,
      });
      setRenderStatus({ type: "error", message: errorMessage });
    }
  };

  return (
    <div className="h-full flex flex-col">
      <h2 className="text-lg font-semibold mb-2">{session.title}</h2>
      <div className="flex-1">
        <Replay ref={ replayRef } session={ session } blocks={ blocks } />
      </div>
      <div className="mt-4 space-y-2">
        <button
          onClick={ handleDownload }
          disabled={renderStatus.type === "loading"}
          className={`px-4 py-2 rounded text-sm ${
            renderStatus.type === "loading"
              ? "bg-gray-400 text-gray-200 cursor-not-allowed"
              : "bg-blue-600 text-white hover:bg-blue-700"
          }`}
        >
          {renderStatus.type === "loading"
            ? "Recording video..."
            : "Download MP4"}
        </button>
        {renderStatus.type === "success" && (
          <p className="text-green-600 text-sm">{renderStatus.message}</p>
        )}
        {renderStatus.type === "error" && (
          <p className="text-red-500 text-sm">
            Download failed: { renderStatus.message }
          </p>
        )}
      </div>
    </div>
  );
}
