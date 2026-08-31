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
      bookings: {
        Row: {
          as_directed_hours: number | null
          assigned_booking_id: number | null
          assigned_reference: string | null
          bags: number | null
          collection_at: string | null
          corporate: string | null
          created_at: string
          dropoff: Json | null
          email: string
          id: string
          journey_type: string
          name: string
          notified_status: string | null
          passengers: number | null
          phone: string
          pickup: Json | null
          reference: string | null
          status: string
          status_checked_at: string | null
          stops: Json | null
          travel_date: string
          user_id: string | null
          vehicle: string
          via: Json | null
        }
        Insert: {
          as_directed_hours?: number | null
          assigned_booking_id?: number | null
          assigned_reference?: string | null
          bags?: number | null
          collection_at?: string | null
          corporate?: string | null
          created_at?: string
          dropoff?: Json | null
          email: string
          id?: string
          journey_type?: string
          name: string
          notified_status?: string | null
          passengers?: number | null
          phone: string
          pickup?: Json | null
          reference?: string | null
          status?: string
          status_checked_at?: string | null
          stops?: Json | null
          travel_date: string
          user_id?: string | null
          vehicle: string
          via?: Json | null
        }
        Update: {
          as_directed_hours?: number | null
          assigned_booking_id?: number | null
          assigned_reference?: string | null
          bags?: number | null
          collection_at?: string | null
          corporate?: string | null
          created_at?: string
          dropoff?: Json | null
          email?: string
          id?: string
          journey_type?: string
          name?: string
          notified_status?: string | null
          passengers?: number | null
          phone?: string
          pickup?: Json | null
          reference?: string | null
          status?: string
          status_checked_at?: string | null
          stops?: Json | null
          travel_date?: string
          user_id?: string | null
          vehicle?: string
          via?: Json | null
        }
        Relationships: []
      }
      bookings_backup_20260818: {
        Row: {
          as_directed_hours: number | null
          assigned_booking_id: number | null
          assigned_reference: string | null
          bags: number | null
          collection_at: string | null
          corporate: string | null
          created_at: string | null
          dropoff: Json | null
          email: string | null
          id: string | null
          journey_type: string | null
          name: string | null
          passengers: number | null
          phone: string | null
          pickup: Json | null
          reference: string | null
          status: string | null
          status_checked_at: string | null
          stops: Json | null
          travel_date: string | null
          user_id: string | null
          vehicle: string | null
          via: Json | null
        }
        Insert: {
          as_directed_hours?: number | null
          assigned_booking_id?: number | null
          assigned_reference?: string | null
          bags?: number | null
          collection_at?: string | null
          corporate?: string | null
          created_at?: string | null
          dropoff?: Json | null
          email?: string | null
          id?: string | null
          journey_type?: string | null
          name?: string | null
          passengers?: number | null
          phone?: string | null
          pickup?: Json | null
          reference?: string | null
          status?: string | null
          status_checked_at?: string | null
          stops?: Json | null
          travel_date?: string | null
          user_id?: string | null
          vehicle?: string | null
          via?: Json | null
        }
        Update: {
          as_directed_hours?: number | null
          assigned_booking_id?: number | null
          assigned_reference?: string | null
          bags?: number | null
          collection_at?: string | null
          corporate?: string | null
          created_at?: string | null
          dropoff?: Json | null
          email?: string | null
          id?: string | null
          journey_type?: string | null
          name?: string | null
          passengers?: number | null
          phone?: string | null
          pickup?: Json | null
          reference?: string | null
          status?: string | null
          status_checked_at?: string | null
          stops?: Json | null
          travel_date?: string | null
          user_id?: string | null
          vehicle?: string | null
          via?: Json | null
        }
        Relationships: []
      }
      corporate_addresses: {
        Row: {
          address: string
          corporate: string
          created_at: string
          grey_tarmac: boolean
          id: string
          label: string
          passenger_id: string | null
        }
        Insert: {
          address: string
          corporate: string
          created_at?: string
          grey_tarmac?: boolean
          id?: string
          label: string
          passenger_id?: string | null
        }
        Update: {
          address?: string
          corporate?: string
          created_at?: string
          grey_tarmac?: boolean
          id?: string
          label?: string
          passenger_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "corporate_addresses_passenger_id_fkey"
            columns: ["passenger_id"]
            isOneToOne: false
            referencedRelation: "corporate_passengers"
            referencedColumns: ["id"]
          },
        ]
      }
      corporate_passengers: {
        Row: {
          active: boolean
          corporate: string
          created_at: string
          email: string
          grp: string
          id: string
          is_group: boolean
          name: string
          notify_email: boolean
          notify_sms: boolean
          notify_target: string
          phone: string
          sort: number
        }
        Insert: {
          active?: boolean
          corporate: string
          created_at?: string
          email?: string
          grp: string
          id?: string
          is_group?: boolean
          name: string
          notify_email?: boolean
          notify_sms?: boolean
          notify_target?: string
          phone?: string
          sort?: number
        }
        Update: {
          active?: boolean
          corporate?: string
          created_at?: string
          email?: string
          grp?: string
          id?: string
          is_group?: boolean
          name?: string
          notify_email?: boolean
          notify_sms?: boolean
          notify_target?: string
          phone?: string
          sort?: number
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      fixture_changes: {
        Row: {
          corporate: string
          detected_at: string
          field: string
          fixture_id: string
          id: string
          new_value: string
          old_value: string
        }
        Insert: {
          corporate: string
          detected_at?: string
          field: string
          fixture_id: string
          id?: string
          new_value?: string
          old_value?: string
        }
        Update: {
          corporate?: string
          detected_at?: string
          field?: string
          fixture_id?: string
          id?: string
          new_value?: string
          old_value?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixture_changes_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
        ]
      }
      fixtures: {
        Row: {
          away_team: string
          club: string
          competition: string
          corporate: string
          created_at: string
          home_team: string
          id: string
          is_home: boolean
          kickoff_utc: string
          last_synced_at: string
          match_number: number
          opponent: string
          round_number: number | null
          season: string
          venue: string
        }
        Insert: {
          away_team: string
          club: string
          competition?: string
          corporate: string
          created_at?: string
          home_team: string
          id?: string
          is_home: boolean
          kickoff_utc: string
          last_synced_at?: string
          match_number: number
          opponent: string
          round_number?: number | null
          season: string
          venue?: string
        }
        Update: {
          away_team?: string
          club?: string
          competition?: string
          corporate?: string
          created_at?: string
          home_team?: string
          id?: string
          is_home?: boolean
          kickoff_utc?: string
          last_synced_at?: string
          match_number?: number
          opponent?: string
          round_number?: number | null
          season?: string
          venue?: string
        }
        Relationships: []
      }
      mfa_codes: {
        Row: {
          attempts: number
          code_hash: string
          created_at: string
          expires_at: string
          id: string
          user_id: string
        }
        Insert: {
          attempts?: number
          code_hash: string
          created_at?: string
          expires_at: string
          id?: string
          user_id: string
        }
        Update: {
          attempts?: number
          code_hash?: string
          created_at?: string
          expires_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      mfa_sessions: {
        Row: {
          id: string
          session_id: string
          user_id: string
          verified_at: string
        }
        Insert: {
          id?: string
          session_id: string
          user_id: string
          verified_at?: string
        }
        Update: {
          id?: string
          session_id?: string
          user_id?: string
          verified_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          address_line1: string
          address_line2: string
          avatar_url: string
          corporate: string | null
          corporate_groups: string[] | null
          country: string
          created_at: string
          email: string
          full_name: string
          id: string
          invited_by: string | null
          phone: string
          postcode: string
          primary_member_id: string | null
          profile_completed: boolean
          status: string
          town: string
        }
        Insert: {
          address_line1?: string
          address_line2?: string
          avatar_url?: string
          corporate?: string | null
          corporate_groups?: string[] | null
          country?: string
          created_at?: string
          email?: string
          full_name?: string
          id: string
          invited_by?: string | null
          phone?: string
          postcode?: string
          primary_member_id?: string | null
          profile_completed?: boolean
          status?: string
          town?: string
        }
        Update: {
          address_line1?: string
          address_line2?: string
          avatar_url?: string
          corporate?: string | null
          corporate_groups?: string[] | null
          country?: string
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          invited_by?: string | null
          phone?: string
          postcode?: string
          primary_member_id?: string | null
          profile_completed?: boolean
          status?: string
          town?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_primary_member_id_fkey"
            columns: ["primary_member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          created_at: string
          endpoint: string
          id: string
          ip_address: string
        }
        Insert: {
          created_at?: string
          endpoint: string
          id?: string
          ip_address: string
        }
        Update: {
          created_at?: string
          endpoint?: string
          id?: string
          ip_address?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      desk_group_allowed: {
        Args: { _grp: string; _user_id: string }
        Returns: boolean
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_family_member_of: {
        Args: { _member: string; _primary: string }
        Returns: boolean
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "member"
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
    Enums: {
      app_role: ["admin", "member"],
    },
  },
} as const
