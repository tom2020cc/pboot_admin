import request from "@/utils/request";

const LONG_REQUEST_TIMEOUT = 180000;

export type VideoPlaylist = {
  id: number;
  playlistId: string;
  title: string;
  thumbUrl: string;
  itemCount: number;
  show: boolean;
  orderNum: number;
  pbootScode: string;
  videoCount?: number;
  shownVideoCount?: number;
  createTime?: string;
  updateTime?: string;
};

export type VideoItem = {
  id: number;
  playlistId: string;
  videoId: string;
  title: string;
  coverUrl: string;
  position: number;
  show: boolean;
  publishedAt: string;
  createTime?: string;
  updateTime?: string;
};

export type PlaylistStats = {
  localCount: number;
  publishableCount: number;
  shellSortExists: boolean;
  videoCount: number;
  shownVideoCount: number;
};

export type YoutubeSyncResult = {
  msg: string;
  total: number;
  created: number;
  updated: number;
  removed: number;
  videoTotal: number;
  videosCreated: number;
  videosUpdated: number;
  videosRemoved: number;
};

export type CleanupResult = {
  msg: string;
  backupPath: string;
  contentsDeleted: number;
  sortsDeleted: number;
  menusRemoved: number;
  shellSortExists: boolean;
};

export type PushVideoListResult = {
  msg: string;
  count: number;
  path: string;
};

export const getPlaylists = () => {
  return request<VideoPlaylist[]>({ method: "GET", url: "/videos" });
};

export const getPlaylistStats = () => {
  return request<PlaylistStats>({ method: "GET", url: "/videos/stats" });
};

export const syncPlaylistsFromYoutube = () => {
  return request<YoutubeSyncResult>({
    method: "POST",
    url: "/videos/youtube-sync",
    data: {},
    timeout: LONG_REQUEST_TIMEOUT,
  });
};

export const cleanupPboot = () => {
  return request<CleanupResult>({
    method: "POST",
    url: "/videos/cleanup-pboot",
    data: {},
    timeout: LONG_REQUEST_TIMEOUT,
  });
};

export const pushVideoList = () => {
  return request<PushVideoListResult>({
    method: "POST",
    url: "/videos/push-list",
    data: {},
  });
};

export const updatePlaylist = (id: number | string, body: { orderNum?: number; show?: boolean }) => {
  return request<VideoPlaylist>({ method: "PATCH", url: `/videos/${id}`, data: body });
};

export const getPlaylistVideos = (playlistId: string) => {
  return request<VideoItem[]>({ method: "GET", url: "/videos/items", params: { playlistId } });
};

export const updateVideoItem = (id: number | string, body: { show?: boolean; position?: number }) => {
  return request<VideoItem>({ method: "PATCH", url: `/videos/items/${id}`, data: body });
};
