export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      book_candidates: {
        Row: {
          authors: string[]
          cover_url: string | null
          created_at: string
          detection_id: string
          external_id: string
          id: string
          isbn_10: string | null
          isbn_13: string | null
          match_score: number | null
          published_year: number | null
          publisher: string | null
          rank: number
          source: string
          title: string
        }
        Insert: {
          authors?: string[]
          cover_url?: string | null
          created_at?: string
          detection_id: string
          external_id: string
          id?: string
          isbn_10?: string | null
          isbn_13?: string | null
          match_score?: number | null
          published_year?: number | null
          publisher?: string | null
          rank: number
          source: string
          title: string
        }
        Update: {
          authors?: string[]
          cover_url?: string | null
          created_at?: string
          detection_id?: string
          external_id?: string
          id?: string
          isbn_10?: string | null
          isbn_13?: string | null
          match_score?: number | null
          published_year?: number | null
          publisher?: string | null
          rank?: number
          source?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "book_candidates_detection_id_fkey"
            columns: ["detection_id"]
            isOneToOne: false
            referencedRelation: "detections"
            referencedColumns: ["id"]
          },
        ]
      }
      books: {
        Row: {
          authors: string[]
          cover_photo_url: string | null
          cover_source: string
          cover_url: string | null
          created_at: string
          id: string
          is_read: boolean
          isbn_10: string | null
          isbn_13: string | null
          notes: string | null
          published_year: number | null
          publisher: string | null
          purchase_date: string | null
          search_text: string | null
          source: string | null
          source_external_id: string | null
          spine_color: string | null
          title: string
          user_cover_url: string | null
          user_id: string
        }
        Insert: {
          authors?: string[]
          cover_photo_url?: string | null
          cover_source?: string
          cover_url?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          isbn_10?: string | null
          isbn_13?: string | null
          notes?: string | null
          published_year?: number | null
          publisher?: string | null
          purchase_date?: string | null
          search_text?: string | null
          source?: string | null
          source_external_id?: string | null
          spine_color?: string | null
          title: string
          user_cover_url?: string | null
          user_id: string
        }
        Update: {
          authors?: string[]
          cover_photo_url?: string | null
          cover_source?: string
          cover_url?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          isbn_10?: string | null
          isbn_13?: string | null
          notes?: string | null
          published_year?: number | null
          publisher?: string | null
          purchase_date?: string | null
          search_text?: string | null
          source?: string | null
          source_external_id?: string | null
          spine_color?: string | null
          title?: string
          user_cover_url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      corrections: {
        Row: {
          corrected_authors: string[] | null
          corrected_title: string | null
          correction_type: string | null
          created_at: string
          detection_id: string | null
          id: string
          original_raw_title: string | null
          user_id: string
        }
        Insert: {
          corrected_authors?: string[] | null
          corrected_title?: string | null
          correction_type?: string | null
          created_at?: string
          detection_id?: string | null
          id?: string
          original_raw_title?: string | null
          user_id: string
        }
        Update: {
          corrected_authors?: string[] | null
          corrected_title?: string | null
          correction_type?: string | null
          created_at?: string
          detection_id?: string | null
          id?: string
          original_raw_title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "corrections_detection_id_fkey"
            columns: ["detection_id"]
            isOneToOne: false
            referencedRelation: "detections"
            referencedColumns: ["id"]
          },
        ]
      }
      detections: {
        Row: {
          bbox_x1: number | null
          bbox_x2: number | null
          bbox_y1: number | null
          bbox_y2: number | null
          created_at: string
          id: string
          photo_id: string
          position_index: number
          raw_author: string | null
          raw_publisher: string | null
          raw_title: string | null
          spine_color: string | null
          status: string
          vision_confidence: number | null
          vision_run_id: string
        }
        Insert: {
          bbox_x1?: number | null
          bbox_x2?: number | null
          bbox_y1?: number | null
          bbox_y2?: number | null
          created_at?: string
          id?: string
          photo_id: string
          position_index: number
          raw_author?: string | null
          raw_publisher?: string | null
          raw_title?: string | null
          spine_color?: string | null
          status?: string
          vision_confidence?: number | null
          vision_run_id: string
        }
        Update: {
          bbox_x1?: number | null
          bbox_x2?: number | null
          bbox_y1?: number | null
          bbox_y2?: number | null
          created_at?: string
          id?: string
          photo_id?: string
          position_index?: number
          raw_author?: string | null
          raw_publisher?: string | null
          raw_title?: string | null
          spine_color?: string | null
          status?: string
          vision_confidence?: number | null
          vision_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "detections_photo_id_fkey"
            columns: ["photo_id"]
            isOneToOne: false
            referencedRelation: "photos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "detections_vision_run_id_fkey"
            columns: ["vision_run_id"]
            isOneToOne: false
            referencedRelation: "vision_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      photos: {
        Row: {
          created_at: string
          detected_count: number | null
          error_message: string | null
          file_hash_sha256: string | null
          id: string
          processed_at: string | null
          shelf_id: string
          status: string
          storage_path: string
          taken_at: string | null
          user_id: string
          vision_cost_usd: number | null
          vision_latency_ms: number | null
          vision_model: string | null
        }
        Insert: {
          created_at?: string
          detected_count?: number | null
          error_message?: string | null
          file_hash_sha256?: string | null
          id?: string
          processed_at?: string | null
          shelf_id: string
          status?: string
          storage_path: string
          taken_at?: string | null
          user_id: string
          vision_cost_usd?: number | null
          vision_latency_ms?: number | null
          vision_model?: string | null
        }
        Update: {
          created_at?: string
          detected_count?: number | null
          error_message?: string | null
          file_hash_sha256?: string | null
          id?: string
          processed_at?: string | null
          shelf_id?: string
          status?: string
          storage_path?: string
          taken_at?: string | null
          user_id?: string
          vision_cost_usd?: number | null
          vision_latency_ms?: number | null
          vision_model?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "photos_shelf_id_fkey"
            columns: ["shelf_id"]
            isOneToOne: false
            referencedRelation: "shelves"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          ai_enabled: boolean
          created_at: string
          display_name: string | null
          id: string
          is_admin: boolean
        }
        Insert: {
          ai_enabled?: boolean
          created_at?: string
          display_name?: string | null
          id: string
          is_admin?: boolean
        }
        Update: {
          ai_enabled?: boolean
          created_at?: string
          display_name?: string | null
          id?: string
          is_admin?: boolean
        }
        Relationships: []
      }
      refine_calls: {
        Row: {
          cost_usd: number | null
          created_at: string
          detection_id: string
          id: string
          latency_ms: number | null
          model: string | null
          photo_id: string
          user_id: string
        }
        Insert: {
          cost_usd?: number | null
          created_at?: string
          detection_id: string
          id?: string
          latency_ms?: number | null
          model?: string | null
          photo_id: string
          user_id: string
        }
        Update: {
          cost_usd?: number | null
          created_at?: string
          detection_id?: string
          id?: string
          latency_ms?: number | null
          model?: string | null
          photo_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "refine_calls_detection_id_fkey"
            columns: ["detection_id"]
            isOneToOne: false
            referencedRelation: "detections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refine_calls_photo_id_fkey"
            columns: ["photo_id"]
            isOneToOne: false
            referencedRelation: "photos"
            referencedColumns: ["id"]
          },
        ]
      }
      shelf_entries: {
        Row: {
          book_id: string
          confirmed_at: string
          detection_id: string | null
          id: string
          is_current: boolean
          photo_id: string | null
          position_index: number | null
          shelf_id: string
        }
        Insert: {
          book_id: string
          confirmed_at?: string
          detection_id?: string | null
          id?: string
          is_current?: boolean
          photo_id?: string | null
          position_index?: number | null
          shelf_id: string
        }
        Update: {
          book_id?: string
          confirmed_at?: string
          detection_id?: string | null
          id?: string
          is_current?: boolean
          photo_id?: string | null
          position_index?: number | null
          shelf_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shelf_entries_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shelf_entries_detection_id_fkey"
            columns: ["detection_id"]
            isOneToOne: false
            referencedRelation: "detections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shelf_entries_photo_id_fkey"
            columns: ["photo_id"]
            isOneToOne: false
            referencedRelation: "photos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shelf_entries_shelf_id_fkey"
            columns: ["shelf_id"]
            isOneToOne: false
            referencedRelation: "shelves"
            referencedColumns: ["id"]
          },
        ]
      }
      shelves: {
        Row: {
          created_at: string
          id: string
          location: string | null
          name: string
          position_index: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          location?: string | null
          name: string
          position_index?: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          location?: string | null
          name?: string
          position_index?: number
          user_id?: string
        }
        Relationships: []
      }
      vision_runs: {
        Row: {
          completed_at: string | null
          cost_usd: number | null
          created_at: string
          error_message: string | null
          id: string
          latency_ms: number | null
          model: string | null
          photo_id: string
          prompt_version: string | null
          status: string
        }
        Insert: {
          completed_at?: string | null
          cost_usd?: number | null
          created_at?: string
          error_message?: string | null
          id?: string
          latency_ms?: number | null
          model?: string | null
          photo_id: string
          prompt_version?: string | null
          status: string
        }
        Update: {
          completed_at?: string | null
          cost_usd?: number | null
          created_at?: string
          error_message?: string | null
          id?: string
          latency_ms?: number | null
          model?: string | null
          photo_id?: string
          prompt_version?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "vision_runs_photo_id_fkey"
            columns: ["photo_id"]
            isOneToOne: false
            referencedRelation: "photos"
            referencedColumns: ["id"]
          },
        ]
      }
      // hand-typed S-32 — regen via 'supabase gen types --linked' after 0016 lands in prod
      // (local stack AV-blocked, see lessons.md)
      user_api_keys: {
        Row: {
          id: string
          user_id: string
          label: string
          provider: 'anthropic' | 'openai' | 'openrouter' | 'openai_compatible'
          model: string | null
          base_url: string | null
          encrypted_key: string
          is_active: boolean
          last_tested_at: string | null
          last_test_result: 'ok' | 'error' | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          label: string
          provider: 'anthropic' | 'openai' | 'openrouter' | 'openai_compatible'
          model?: string | null
          base_url?: string | null
          encrypted_key: string
          is_active?: boolean
          last_tested_at?: string | null
          last_test_result?: 'ok' | 'error' | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          label?: string
          provider?: 'anthropic' | 'openai' | 'openrouter' | 'openai_compatible'
          model?: string | null
          base_url?: string | null
          encrypted_key?: string
          is_active?: boolean
          last_tested_at?: string | null
          last_test_result?: 'ok' | 'error' | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_api_keys_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      books_search_text: {
        Args: { p_authors: string[]; p_publisher: string; p_title: string }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
