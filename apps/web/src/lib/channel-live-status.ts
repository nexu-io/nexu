export type ChannelLiveStatus =
  | "connected"
  | "connecting"
  | "disconnected"
  | "error"
  | "restarting";

export function getChannelStatusLabel(
  status: ChannelLiveStatus | undefined,
  labels: {
    connected: string;
    connecting: string;
    disconnected: string;
    error: string;
    restarting: string;
  },
): string {
  switch (status) {
    case "connected":
      return labels.connected;
    case "connecting":
      return labels.connecting;
    case "restarting":
      return labels.restarting;
    case "error":
      return labels.error;
    default:
      return labels.disconnected;
  }
}
