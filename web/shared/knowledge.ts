export type FeedbackTag = "incorrect" | "incomplete" | "too slow" | "unsafe" | "confusing" | "excellent";
export interface Feedback { rating: number | null; tags: FeedbackTag[]; note: string; category: string }
export interface Checkpoint {
  id: string; session_id: string; project_path: string; digest: string; name: string;
  category: string; scope: string[]; markdown: string; capture_status: string;
  warning: string | null; redactions: number; feedback: Feedback;
  artifact_path: string | null; updated_at: string;
}
export interface Lesson {
  id: string; session_id: string; checkpoint_id: string; project_path: string;
  category: string; scope: string[]; status: "draft" | "approved" | "rejected";
  title: string; instruction: string; rationale: string; evidence: string;
  confidence: "low" | "medium" | "high"; kind: string; conflicts: string[]; updated_at: string;
}
export interface Knowledge { checkpoints: Checkpoint[]; lessons: Lesson[]; categories: string[] }
export interface Preflight {
  warnings: { session_id: string; name: string; rating: number; tags: string[]; note: string }[];
  lessons: Lesson[]; suggested_categories: string[];
}

export interface LearningProvider {
  id: string; label: string; base_url: string; default_model: string | null;
  configured: boolean; user_configured: boolean; has_key: boolean; requires_key: boolean;
  kind: string; models: string[];
}
export interface LearningSettings {
  providers: LearningProvider[]; default_provider: string | null; app_default: boolean;
}
export interface LearningConnectionInput {
  provider_id: string; api_key?: string; model: string; base_url: string;
}
