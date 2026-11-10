export interface Post {
  id: number;
  user_id: number;
  username: string;
  avatar_url: string;
  category?: string;
  content: string;
  image_url: string | null;
  image_urls?: string[];
  likes_count: number;
  comment_count?: number;
  views_count?: number;
  is_liked?: boolean;
  event_start_at?: string | null;
  event_end_at?: string | null;
  participant_count?: number;
  is_joined?: boolean;
  question_status?: "open" | "resolved" | null;
  accepted_comment_id?: number | null;
  author_is_expert?: boolean;
  recommendation_reason?: string;
  recommendation_score?: number;
  ip_location?: string | null;
  created_at: string;
  linked_recipe?: import("@/components/LinkedRecipeCard").LinkedRecipeSummary | null;
  linked_recipe_unavailable?: boolean;
}

export type ActivityStatus = "ongoing" | "upcoming" | "ended";
