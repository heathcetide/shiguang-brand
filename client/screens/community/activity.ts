import type { ActivityStatus, Post } from "./types";

export const parseCommunityDate = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
};

export const getActivityStatus = (post: Post, now = Date.now()): ActivityStatus => {
  const startTime = parseCommunityDate(post.event_start_at)?.getTime();
  const endTime = parseCommunityDate(post.event_end_at)?.getTime();
  if (startTime && startTime > now) return "upcoming";
  if (endTime && endTime < now) return "ended";
  return "ongoing";
};

export const formatActivityDate = (value?: string | null) => {
  const date = parseCommunityDate(value);
  if (!date) return "长期开放";
  return `${date.getMonth() + 1}月${date.getDate()}日`;
};
