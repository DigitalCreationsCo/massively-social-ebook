import { useState, useCallback } from "react";
import { useAdminToken } from "../../hooks/useAdminToken";
import { usePolling } from "../../hooks/usePolling";
import { adminFetch } from "../../api/client";
import { Session, Channel } from "@shared/schema";
import React, { Suspense } from "react";

// Lazy load the Replay component
const ReplayDetail = React.lazy(() => import("./ReplayDetail"));

export default function ReplaysTab() {
  const { token } = useAdminToken();
  const [channelFilter, setChannelFilter] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(
    null,
  );

  // Fetch channels
  const fetchChannels = useCallback(async () => {
    return adminFetch<Channel[]>("/channels", token);
  }, [token]);
  const {
    data: channels,
    error: channelsError,
  } = usePolling(fetchChannels, 60000, [token]);

  // Fetch completed sessions for the channel
  const fetchSessions = useCallback(async () => {
    if (!channelFilter) return [];
    // We can reuse the adminFetch for /sessions and filter for completed
    const sessions = await adminFetch<Session[]>(
      `/sessions?channelId=${channelFilter}`,
      token,
    );
    return sessions.filter((s) => s.status === "completed");
  }, [token, channelFilter]);

  const {
    data: sessions,
    loading: sessionsLoading,
    error: sessionsError,
  } = usePolling(fetchSessions, 30000, [token, channelFilter]);

  return (
    <div className="p-4 flex h-full gap-4">
      <div className="w-1/3 border border-gray-200 rounded-lg p-4">
        <h3 className="font-medium mb-4">Select Session</h3>
        <select
          value={channelFilter}
          onChange={(e) => {
            setChannelFilter(e.target.value);
            setSelectedSessionId(null);
          }}
          className="border border-gray-300 rounded px-2 py-1 text-sm w-full mb-4"
        >
          <option value="">All Channels</option>
          {(channels || []).map((ch) => (
            <option key={ch.id} value={ch.channelId}>
              {ch.name}
            </option>
          ))}
        </select>

        {channelsError && (
          <p className="text-red-500 text-sm mb-2">
            Failed to load channels: {channelsError.message}
          </p>
        )}
        {sessionsError && (
          <p className="text-red-500 text-sm mb-2">
            Failed to load sessions: {sessionsError.message}
          </p>
        )}
        {sessionsLoading && <p className="text-gray-500 text-sm mb-2">Loading sessions...</p>}
        <div className="space-y-2">
          {(sessions || []).map((session) => (
            <button
              key={session.id}
              onClick={() => setSelectedSessionId(session.id)}
              className={`w-full text-left px-3 py-2 rounded ${
                selectedSessionId === session.id
                  ? "bg-blue-100 text-blue-700"
                  : "hover:bg-gray-100"
              }`}
            >
              {session.title}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 border border-gray-200 rounded-lg p-4">
        {selectedSessionId ? (
          <Suspense fallback={<p>Loading replay player...</p>}>
            <ReplayDetail
              sessionId={selectedSessionId}
              channelId={channelFilter}
            />
          </Suspense>
        ) : (
          <p className="text-gray-500">Select a session to view replay</p>
        )}
      </div>
    </div>
  );
}
