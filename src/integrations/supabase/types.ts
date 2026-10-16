export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      ai_actions: {
        Row: {
          action_type: string;
          approved_by: string | null;
          created_at: string;
          executed_at: string | null;
          id: string;
          proposed_payload: Json | null;
          reason: string | null;
          requested_by: string | null;
          risk_level: string;
          status: string;
          target_summary: string | null;
          title: string;
        };
        Insert: {
          action_type: string;
          approved_by?: string | null;
          created_at?: string;
          executed_at?: string | null;
          id?: string;
          proposed_payload?: Json | null;
          reason?: string | null;
          requested_by?: string | null;
          risk_level?: string;
          status?: string;
          target_summary?: string | null;
          title: string;
        };
        Update: {
          action_type?: string;
          approved_by?: string | null;
          created_at?: string;
          executed_at?: string | null;
          id?: string;
          proposed_payload?: Json | null;
          reason?: string | null;
          requested_by?: string | null;
          risk_level?: string;
          status?: string;
          target_summary?: string | null;
          title?: string;
        };
        Relationships: [];
      };
      ai_conversations: {
        Row: {
          created_at: string;
          id: string;
          title: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          title?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          title?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      ai_insights: {
        Row: {
          created_at: string;
          detail: string | null;
          id: string;
          link: string | null;
          recommended_action: string | null;
          severity: string;
          title: string;
        };
        Insert: {
          created_at?: string;
          detail?: string | null;
          id?: string;
          link?: string | null;
          recommended_action?: string | null;
          severity?: string;
          title: string;
        };
        Update: {
          created_at?: string;
          detail?: string | null;
          id?: string;
          link?: string | null;
          recommended_action?: string | null;
          severity?: string;
          title?: string;
        };
        Relationships: [];
      };
      ai_messages: {
        Row: {
          content: string;
          conversation_id: string;
          created_at: string;
          id: string;
          payload: Json | null;
          role: string;
          sources: Json | null;
        };
        Insert: {
          content: string;
          conversation_id: string;
          created_at?: string;
          id?: string;
          payload?: Json | null;
          role: string;
          sources?: Json | null;
        };
        Update: {
          content?: string;
          conversation_id?: string;
          created_at?: string;
          id?: string;
          payload?: Json | null;
          role?: string;
          sources?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "ai_messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "ai_conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      applications: {
        Row: {
          ai_screening: Json | null;
          answers: Json | null;
          candidate_id: string;
          consent: boolean;
          cover_letter: string | null;
          created_at: string;
          id: string;
          match_score: number | null;
          organization_id: string | null;
          rejection_reason: string | null;
          requisition_id: string;
          resume_path: string | null;
          source: string | null;
          stage: string;
          status: string;
          updated_at: string;
          candidates?: {
            email: string | null;
            experience_years: number | null;
            full_name: string;
            id: string;
          } | null;
          job_requisitions?: {
            id: string;
            title: string | null;
          } | null;
        };
        Insert: {
          ai_screening?: Json | null;
          answers?: Json | null;
          candidate_id: string;
          consent?: boolean;
          cover_letter?: string | null;
          created_at?: string;
          id?: string;
          match_score?: number | null;
          organization_id?: string | null;
          rejection_reason?: string | null;
          requisition_id: string;
          resume_path?: string | null;
          source?: string | null;
          stage?: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          ai_screening?: Json | null;
          answers?: Json | null;
          candidate_id?: string;
          consent?: boolean;
          cover_letter?: string | null;
          created_at?: string;
          id?: string;
          match_score?: number | null;
          organization_id?: string | null;
          rejection_reason?: string | null;
          requisition_id?: string;
          resume_path?: string | null;
          source?: string | null;
          stage?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "applications_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "applications_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "applications_requisition_id_fkey";
            columns: ["requisition_id"];
            isOneToOne: false;
            referencedRelation: "job_requisitions";
            referencedColumns: ["id"];
          },
        ];
      };
      attendance_corrections: {
        Row: {
          attendance_id: string | null;
          approver_id: string | null;
          created_at: string;
          decided_at: string | null;
          decision_note: string | null;
          employee_id: string;
          id: string;
          reason: string | null;
          requested_check_in: string | null;
          requested_check_out: string | null;
          requested_status: string | null;
          status: string;
          work_date: string;
        };
        Insert: {
          attendance_id?: string | null;
          approver_id?: string | null;
          created_at?: string;
          decided_at?: string | null;
          decision_note?: string | null;
          employee_id: string;
          id?: string;
          reason?: string | null;
          requested_check_in?: string | null;
          requested_check_out?: string | null;
          requested_status?: string | null;
          status?: string;
          work_date: string;
        };
        Update: {
          attendance_id?: string | null;
          approver_id?: string | null;
          created_at?: string;
          decided_at?: string | null;
          decision_note?: string | null;
          employee_id?: string;
          id?: string;
          reason?: string | null;
          requested_check_in?: string | null;
          requested_check_out?: string | null;
          requested_status?: string | null;
          status?: string;
          work_date?: string;
        };
        Relationships: [];
      };
      attendance_records: {
        Row: {
          check_in: string | null;
          check_out: string | null;
          created_at: string;
          early_departure_minutes: number;
          early_login_minutes: number;
          employee_id: string;
          id: string;
          is_half_day: boolean;
          late_logout_minutes: number;
          late_minutes: number;
          note: string | null;
          overtime_minutes: number;
          source: string;
          status: string;
          updated_by: string | null;
          work_date: string;
          work_hours: number | null;
          work_minutes: number | null;
        };
        Insert: {
          check_in?: string | null;
          check_out?: string | null;
          created_at?: string;
          early_departure_minutes?: number;
          early_login_minutes?: number;
          employee_id: string;
          id?: string;
          is_half_day?: boolean;
          late_logout_minutes?: number;
          late_minutes?: number;
          note?: string | null;
          overtime_minutes?: number;
          source?: string;
          status?: string;
          updated_by?: string | null;
          work_date: string;
          work_hours?: number | null;
          work_minutes?: number | null;
        };
        Update: {
          check_in?: string | null;
          check_out?: string | null;
          created_at?: string;
          early_departure_minutes?: number;
          early_login_minutes?: number;
          employee_id?: string;
          id?: string;
          is_half_day?: boolean;
          late_logout_minutes?: number;
          late_minutes?: number;
          note?: string | null;
          overtime_minutes?: number;
          source?: string;
          status?: string;
          updated_by?: string | null;
          work_date?: string;
          work_hours?: number | null;
          work_minutes?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "attendance_records_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_logs: {
        Row: {
          action: string;
          created_at: string;
          entity: string | null;
          entity_id: string | null;
          id: string;
          new_value: Json | null;
          previous_value: Json | null;
          status: string;
          user_id: string | null;
        };
        Insert: {
          action: string;
          created_at?: string;
          entity?: string | null;
          entity_id?: string | null;
          id?: string;
          new_value?: Json | null;
          previous_value?: Json | null;
          status?: string;
          user_id?: string | null;
        };
        Update: {
          action?: string;
          created_at?: string;
          entity?: string | null;
          entity_id?: string | null;
          id?: string;
          new_value?: Json | null;
          previous_value?: Json | null;
          status?: string;
          user_id?: string | null;
        };
        Relationships: [];
      };
      candidates: {
        Row: {
          ai_analysis: Json | null;
          applied_at: string;
          education: string | null;
          email: string | null;
          expected_salary: string | null;
          experience_years: number | null;
          full_name: string;
          id: string;
          job_id: string | null;
          location: string | null;
          match_score: number | null;
          notice_period: string | null;
          organization_id: string | null;
          parsed_resume: Json | null;
          phone: string | null;
          resume_path: string | null;
          resume_url: string | null;
          skills: string[] | null;
          source: string | null;
          stage: string;
        };
        Insert: {
          ai_analysis?: Json | null;
          applied_at?: string;
          education?: string | null;
          email?: string | null;
          expected_salary?: string | null;
          experience_years?: number | null;
          full_name: string;
          id?: string;
          job_id?: string | null;
          location?: string | null;
          match_score?: number | null;
          notice_period?: string | null;
          organization_id?: string | null;
          parsed_resume?: Json | null;
          phone?: string | null;
          resume_path?: string | null;
          resume_url?: string | null;
          skills?: string[] | null;
          source?: string | null;
          stage?: string;
        };
        Update: {
          ai_analysis?: Json | null;
          applied_at?: string;
          education?: string | null;
          email?: string | null;
          expected_salary?: string | null;
          experience_years?: number | null;
          full_name?: string;
          id?: string;
          job_id?: string | null;
          location?: string | null;
          match_score?: number | null;
          notice_period?: string | null;
          organization_id?: string | null;
          parsed_resume?: Json | null;
          phone?: string | null;
          resume_path?: string | null;
          resume_url?: string | null;
          skills?: string[] | null;
          source?: string | null;
          stage?: string;
        };
        Relationships: [
          {
            foreignKeyName: "candidates_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "job_requisitions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "candidates_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      candidate_screenings: {
        Row: {
          action_type: string;
          candidate_id: string;
          created_at: string;
          created_by: string | null;
          evidence: Json | null;
          id: string;
          rating: string;
          requisition_id: string | null;
          score: number;
          summary: string | null;
        };
        Insert: {
          action_type?: string;
          candidate_id: string;
          created_at?: string;
          created_by?: string | null;
          evidence?: Json | null;
          id?: string;
          rating?: string;
          requisition_id?: string | null;
          score?: number;
          summary?: string | null;
        };
        Update: {
          action_type?: string;
          candidate_id?: string;
          created_at?: string;
          created_by?: string | null;
          evidence?: Json | null;
          id?: string;
          rating?: string;
          requisition_id?: string | null;
          score?: number;
          summary?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "candidate_screenings_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "candidate_screenings_requisition_id_fkey";
            columns: ["requisition_id"];
            isOneToOne: false;
            referencedRelation: "job_requisitions";
            referencedColumns: ["id"];
          },
        ];
      };
      company_assets: {
        Row: {
          asset_tag: string | null;
          category: string;
          created_at: string;
          id: string;
          name: string;
          notes: string | null;
          organization_id: string | null;
          purchase_date: string | null;
          purchase_value: number | null;
          serial_number: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          asset_tag?: string | null;
          category?: string;
          created_at?: string;
          id?: string;
          name: string;
          notes?: string | null;
          organization_id?: string | null;
          purchase_date?: string | null;
          purchase_value?: number | null;
          serial_number?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          asset_tag?: string | null;
          category?: string;
          created_at?: string;
          id?: string;
          name?: string;
          notes?: string | null;
          organization_id?: string | null;
          purchase_date?: string | null;
          purchase_value?: number | null;
          serial_number?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "company_assets_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      compliance_items: {
        Row: {
          category: string;
          created_at: string;
          default_due_in_days: number;
          description: string | null;
          id: string;
          organization_id: string | null;
          recurrence: string;
          status: string;
          title: string;
        };
        Insert: {
          category?: string;
          created_at?: string;
          default_due_in_days?: number;
          description?: string | null;
          id?: string;
          organization_id?: string | null;
          recurrence?: string;
          status?: string;
          title: string;
        };
        Update: {
          category?: string;
          created_at?: string;
          default_due_in_days?: number;
          description?: string | null;
          id?: string;
          organization_id?: string | null;
          recurrence?: string;
          status?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "compliance_items_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      company_holidays: {
        Row: {
          created_at: string;
          date: string;
          id: string;
          name: string;
          optional: boolean;
          organization_id: string | null;
        };
        Insert: {
          created_at?: string;
          date: string;
          id?: string;
          name?: string;
          optional?: boolean;
          organization_id?: string | null;
        };
        Update: {
          created_at?: string;
          date?: string;
          id?: string;
          name?: string;
          optional?: boolean;
          organization_id?: string | null;
        };
        Relationships: [];
      };
      departments: {
        Row: {
          code: string;
          created_at: string;
          department_head_id: string | null;
          id: string;
          name: string;
          organization_id: string;
          status: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          department_head_id?: string | null;
          id?: string;
          name: string;
          organization_id: string;
          status?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          department_head_id?: string | null;
          id?: string;
          name?: string;
          organization_id?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "departments_department_head_id_fkey";
            columns: ["department_head_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "departments_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      document_verifications: {
        Row: {
          action: string;
          comment: string | null;
          created_at: string;
          document_id: string;
          id: string;
          new_status: string | null;
          previous_status: string | null;
          reviewer_id: string | null;
        };
        Insert: {
          action: string;
          comment?: string | null;
          created_at?: string;
          document_id: string;
          id?: string;
          new_status?: string | null;
          previous_status?: string | null;
          reviewer_id?: string | null;
        };
        Update: {
          action?: string;
          comment?: string | null;
          created_at?: string;
          document_id?: string;
          id?: string;
          new_status?: string | null;
          previous_status?: string | null;
          reviewer_id?: string | null;
        };
        Relationships: [];
      };
      employee_asset_assignments: {
        Row: {
          asset_id: string;
          assigned_at: string;
          assigned_by: string | null;
          created_at: string;
          employee_id: string;
          expected_return: string | null;
          id: string;
          return_note: string | null;
          returned_at: string | null;
          status: string;
        };
        Insert: {
          asset_id: string;
          assigned_at?: string;
          assigned_by?: string | null;
          created_at?: string;
          employee_id: string;
          expected_return?: string | null;
          id?: string;
          return_note?: string | null;
          returned_at?: string | null;
          status?: string;
        };
        Update: {
          asset_id?: string;
          assigned_at?: string;
          assigned_by?: string | null;
          created_at?: string;
          employee_id?: string;
          expected_return?: string | null;
          id?: string;
          return_note?: string | null;
          returned_at?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "employee_asset_assignments_asset_id_fkey";
            columns: ["asset_id"];
            isOneToOne: false;
            referencedRelation: "company_assets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "employee_asset_assignments_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      employee_compliance: {
        Row: {
          completed_at: string | null;
          created_at: string;
          due_date: string | null;
          employee_id: string;
          evidence_url: string | null;
          id: string;
          item_id: string;
          notes: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          due_date?: string | null;
          employee_id: string;
          evidence_url?: string | null;
          id?: string;
          item_id: string;
          notes?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          due_date?: string | null;
          employee_id?: string;
          evidence_url?: string | null;
          id?: string;
          item_id?: string;
          notes?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "employee_compliance_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "employee_compliance_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "compliance_items";
            referencedColumns: ["id"];
          },
        ];
      };
      employee_documents: {
        Row: {
          category: string;
          created_at: string;
          employee_id: string | null;
          expiry_date: string | null;
          file_url: string | null;
          id: string;
          name: string;
          uploaded_by: string | null;
          verification_comment: string | null;
          verification_status: string;
          verified_at: string | null;
          version: number;
          reviewer_id: string | null;
        };
        Insert: {
          category?: string;
          created_at?: string;
          employee_id?: string | null;
          expiry_date?: string | null;
          file_url?: string | null;
          id?: string;
          name: string;
          uploaded_by?: string | null;
          verification_comment?: string | null;
          verification_status?: string;
          verified_at?: string | null;
          version?: number;
          reviewer_id?: string | null;
        };
        Update: {
          category?: string;
          created_at?: string;
          employee_id?: string | null;
          expiry_date?: string | null;
          file_url?: string | null;
          id?: string;
          name?: string;
          uploaded_by?: string | null;
          verification_comment?: string | null;
          verification_status?: string;
          verified_at?: string | null;
          version?: number;
          reviewer_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "employee_documents_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      employee_lifecycle_events: {
        Row: {
          actor_id: string | null;
          created_at: string;
          effective_date: string;
          employee_id: string;
          event_type: string;
          id: string;
          new_value: Json | null;
          previous_value: Json | null;
          reason: string | null;
        };
        Insert: {
          actor_id?: string | null;
          created_at?: string;
          effective_date?: string;
          employee_id: string;
          event_type: string;
          id?: string;
          new_value?: Json | null;
          previous_value?: Json | null;
          reason?: string | null;
        };
        Update: {
          actor_id?: string | null;
          created_at?: string;
          effective_date?: string;
          employee_id?: string;
          event_type?: string;
          id?: string;
          new_value?: Json | null;
          previous_value?: Json | null;
          reason?: string | null;
        };
        Relationships: [];
      };
      employee_letters: {
        Row: {
          content: string;
          created_at: string;
          created_by: string | null;
          employee_id: string;
          id: string;
          issued_at: string | null;
          issued_by: string | null;
          letter_type: string;
          organization_id: string | null;
          status: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          content: string;
          created_at?: string;
          created_by?: string | null;
          employee_id: string;
          id?: string;
          issued_at?: string | null;
          issued_by?: string | null;
          letter_type?: string;
          organization_id?: string | null;
          status?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          created_by?: string | null;
          employee_id?: string;
          id?: string;
          issued_at?: string | null;
          issued_by?: string | null;
          letter_type?: string;
          organization_id?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "employee_letters_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "employee_letters_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      employee_salaries: {
        Row: {
          allowances: Json;
          basic: number;
          created_at: string;
          currency: string;
          deductions: Json;
          effective_from: string;
          employee_id: string;
          id: string;
          notes: string | null;
          updated_at: string;
        };
        Insert: {
          allowances?: Json;
          basic?: number;
          created_at?: string;
          currency?: string;
          deductions?: Json;
          effective_from?: string;
          employee_id: string;
          id?: string;
          notes?: string | null;
          updated_at?: string;
        };
        Update: {
          allowances?: Json;
          basic?: number;
          created_at?: string;
          currency?: string;
          deductions?: Json;
          effective_from?: string;
          employee_id?: string;
          id?: string;
          notes?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "employee_salaries_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      employee_shift_assignments: {
        Row: {
          assigned_by: string | null;
          created_at: string;
          effective_from: string;
          effective_to: string | null;
          employee_id: string;
          id: string;
          is_active: boolean;
          notes: string | null;
          shift_id: string;
        };
        Insert: {
          assigned_by?: string | null;
          created_at?: string;
          effective_from?: string;
          effective_to?: string | null;
          employee_id: string;
          id?: string;
          is_active?: boolean;
          notes?: string | null;
          shift_id: string;
        };
        Update: {
          assigned_by?: string | null;
          created_at?: string;
          effective_from?: string;
          effective_to?: string | null;
          employee_id?: string;
          id?: string;
          is_active?: boolean;
          notes?: string | null;
          shift_id?: string;
        };
        Relationships: [];
      };
      employees: {
        Row: {
          created_at: string;
          date_of_birth: string | null;
          department_id: string | null;
          designation: string | null;
          emergency_contact: string | null;
          employee_code: string;
          employment_status: string;
          employment_type: string;
          first_name: string;
          gender: string | null;
          id: string;
          joining_date: string;
          last_name: string;
          legal_entity_id: string | null;
          location_id: string | null;
          manager_id: string | null;
          organization_id: string | null;
          phone: string | null;
          probation_end_date: string | null;
          profile_photo: string | null;
          updated_at: string;
          user_id: string | null;
          work_email: string | null;
        };
        Insert: {
          created_at?: string;
          date_of_birth?: string | null;
          department_id?: string | null;
          designation?: string | null;
          emergency_contact?: string | null;
          employee_code: string;
          employment_status?: string;
          employment_type?: string;
          first_name: string;
          gender?: string | null;
          id?: string;
          joining_date?: string;
          last_name: string;
          legal_entity_id?: string | null;
          location_id?: string | null;
          manager_id?: string | null;
          organization_id?: string | null;
          phone?: string | null;
          probation_end_date?: string | null;
          profile_photo?: string | null;
          updated_at?: string;
          user_id?: string | null;
          work_email?: string | null;
        };
        Update: {
          created_at?: string;
          date_of_birth?: string | null;
          department_id?: string | null;
          designation?: string | null;
          emergency_contact?: string | null;
          employee_code?: string;
          employment_status?: string;
          employment_type?: string;
          first_name?: string;
          gender?: string | null;
          id?: string;
          joining_date?: string;
          last_name?: string;
          legal_entity_id?: string | null;
          location_id?: string | null;
          manager_id?: string | null;
          organization_id?: string | null;
          phone?: string | null;
          probation_end_date?: string | null;
          profile_photo?: string | null;
          updated_at?: string;
          user_id?: string | null;
          work_email?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "employees_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "departments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "employees_legal_entity_id_fkey";
            columns: ["legal_entity_id"];
            isOneToOne: false;
            referencedRelation: "legal_entities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "employees_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "employees_manager_id_fkey";
            columns: ["manager_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "employees_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      employee_trainings: {
        Row: {
          certificate: string | null;
          completed_at: string | null;
          employee_id: string;
          enrolled_at: string;
          enrolled_by: string | null;
          id: string;
          notes: string | null;
          program_id: string;
          score: number | null;
          session_id: string | null;
          status: string;
        };
        Insert: {
          certificate?: string | null;
          completed_at?: string | null;
          employee_id: string;
          enrolled_at?: string;
          enrolled_by?: string | null;
          id?: string;
          notes?: string | null;
          program_id: string;
          score?: number | null;
          session_id?: string | null;
          status?: string;
        };
        Update: {
          certificate?: string | null;
          completed_at?: string | null;
          employee_id?: string;
          enrolled_at?: string;
          enrolled_by?: string | null;
          id?: string;
          notes?: string | null;
          program_id?: string;
          score?: number | null;
          session_id?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "employee_trainings_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "employee_trainings_program_id_fkey";
            columns: ["program_id"];
            isOneToOne: false;
            referencedRelation: "training_programs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "employee_trainings_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "training_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      exit_checklist_items: {
        Row: {
          category: string;
          completed_at: string | null;
          created_at: string;
          due_date: string | null;
          id: string;
          offboarding_id: string;
          owner: string;
          status: string;
          title: string;
        };
        Insert: {
          category?: string;
          completed_at?: string | null;
          created_at?: string;
          due_date?: string | null;
          id?: string;
          offboarding_id: string;
          owner?: string;
          status?: string;
          title: string;
        };
        Update: {
          category?: string;
          completed_at?: string | null;
          created_at?: string;
          due_date?: string | null;
          id?: string;
          offboarding_id?: string;
          owner?: string;
          status?: string;
          title?: string;
        };
        Relationships: [];
      };
      expense_policies: {
        Row: {
          category: string;
          created_at: string;
          currency: string;
          id: string;
          max_amount: number | null;
          notes: string | null;
          organization_id: string | null;
          requires_receipt: boolean;
        };
        Insert: {
          category: string;
          created_at?: string;
          currency?: string;
          id?: string;
          max_amount?: number | null;
          notes?: string | null;
          organization_id?: string | null;
          requires_receipt?: boolean;
        };
        Update: {
          category?: string;
          created_at?: string;
          currency?: string;
          id?: string;
          max_amount?: number | null;
          notes?: string | null;
          organization_id?: string | null;
          requires_receipt?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "expense_policies_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      expense_requests: {
        Row: {
          amount: number;
          approver_id: string | null;
          category: string;
          created_at: string;
          currency: string;
          decided_at: string | null;
          decision_note: string | null;
          description: string | null;
          employee_id: string;
          expense_date: string;
          id: string;
          receipt_path: string | null;
          reimbursed_at: string | null;
          reimbursed_by: string | null;
          status: string;
        };
        Insert: {
          amount?: number;
          approver_id?: string | null;
          category?: string;
          created_at?: string;
          currency?: string;
          decided_at?: string | null;
          decision_note?: string | null;
          description?: string | null;
          employee_id: string;
          expense_date?: string;
          id?: string;
          receipt_path?: string | null;
          reimbursed_at?: string | null;
          reimbursed_by?: string | null;
          status?: string;
        };
        Update: {
          amount?: number;
          approver_id?: string | null;
          category?: string;
          created_at?: string;
          currency?: string;
          decided_at?: string | null;
          decision_note?: string | null;
          description?: string | null;
          employee_id?: string;
          expense_date?: string;
          id?: string;
          receipt_path?: string | null;
          reimbursed_at?: string | null;
          reimbursed_by?: string | null;
          status?: string;
        };
        Relationships: [];
      };
      generated_documents: {
        Row: {
          body: string;
          created_at: string;
          created_by: string | null;
          employee_id: string | null;
          id: string;
          status: string;
          template: string;
          title: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          created_by?: string | null;
          employee_id?: string | null;
          id?: string;
          status?: string;
          template: string;
          title: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          created_by?: string | null;
          employee_id?: string | null;
          id?: string;
          status?: string;
          template?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "generated_documents_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      goals: {
        Row: {
          created_at: string;
          cycle_id: string | null;
          description: string | null;
          due_date: string | null;
          employee_id: string;
          id: string;
          progress: number;
          status: string;
          title: string;
        };
        Insert: {
          created_at?: string;
          cycle_id?: string | null;
          description?: string | null;
          due_date?: string | null;
          employee_id: string;
          id?: string;
          progress?: number;
          status?: string;
          title: string;
        };
        Update: {
          created_at?: string;
          cycle_id?: string | null;
          description?: string | null;
          due_date?: string | null;
          employee_id?: string;
          id?: string;
          progress?: number;
          status?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "goals_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      helpdesk_tickets: {
        Row: {
          assigned_to: string | null;
          category: string;
          created_at: string;
          created_by: string | null;
          department_id: string | null;
          description: string | null;
          employee_id: string | null;
          escalated_at: string | null;
          escalation_level: number;
          id: string;
          organization_id: string | null;
          priority: string;
          resolution_summary: string | null;
          resolved_at: string | null;
          sla_due_at: string | null;
          status: string;
          subject: string;
          ticket_code: string;
          updated_at: string;
        };
        Insert: {
          assigned_to?: string | null;
          category?: string;
          created_at?: string;
          created_by?: string | null;
          department_id?: string | null;
          description?: string | null;
          employee_id?: string | null;
          escalated_at?: string | null;
          escalation_level?: number;
          id?: string;
          organization_id?: string | null;
          priority?: string;
          resolution_summary?: string | null;
          resolved_at?: string | null;
          sla_due_at?: string | null;
          status?: string;
          subject: string;
          ticket_code?: string;
          updated_at?: string;
        };
        Update: {
          assigned_to?: string | null;
          category?: string;
          created_at?: string;
          created_by?: string | null;
          department_id?: string | null;
          description?: string | null;
          employee_id?: string | null;
          escalated_at?: string | null;
          escalation_level?: number;
          id?: string;
          organization_id?: string | null;
          priority?: string;
          resolution_summary?: string | null;
          resolved_at?: string | null;
          sla_due_at?: string | null;
          status?: string;
          subject?: string;
          ticket_code?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "helpdesk_tickets_assigned_to_fkey";
            columns: ["assigned_to"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "helpdesk_tickets_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      interview_feedback: {
        Row: {
          concerns: string | null;
          created_at: string;
          id: string;
          interview_id: string;
          notes: string | null;
          rating: number | null;
          recommendation: string | null;
          reviewer_id: string | null;
          strengths: string | null;
        };
        Insert: {
          concerns?: string | null;
          created_at?: string;
          id?: string;
          interview_id: string;
          notes?: string | null;
          rating?: number | null;
          recommendation?: string | null;
          reviewer_id?: string | null;
          strengths?: string | null;
        };
        Update: {
          concerns?: string | null;
          created_at?: string;
          id?: string;
          interview_id?: string;
          notes?: string | null;
          rating?: number | null;
          recommendation?: string | null;
          reviewer_id?: string | null;
          strengths?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "interview_feedback_interview_id_fkey";
            columns: ["interview_id"];
            isOneToOne: false;
            referencedRelation: "interviews";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "interview_feedback_reviewer_id_fkey";
            columns: ["reviewer_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      interview_panel: {
        Row: {
          employee_id: string;
          id: string;
          interview_id: string;
          role: string | null;
        };
        Insert: {
          employee_id: string;
          id?: string;
          interview_id: string;
          role?: string | null;
        };
        Update: {
          employee_id?: string;
          id?: string;
          interview_id?: string;
          role?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "interview_panel_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "interview_panel_interview_id_fkey";
            columns: ["interview_id"];
            isOneToOne: false;
            referencedRelation: "interviews";
            referencedColumns: ["id"];
          },
        ];
      };
      interviews: {
        Row: {
          application_id: string;
          created_at: string;
          created_by: string | null;
          duration_minutes: number | null;
          id: string;
          interview_type: string;
          location: string | null;
          meeting_link: string | null;
          organization_id: string | null;
          outcome: string | null;
          round: string;
          scheduled_at: string | null;
          status: string;
          interview_feedback?: Array<{
            concerns: string | null;
            id: string;
            notes: string | null;
            rating: number | null;
            recommendation: string | null;
            strengths: string | null;
          }> | null;
        };
        Insert: {
          application_id?: string;
          created_at?: string;
          created_by?: string | null;
          duration_minutes?: number | null;
          id?: string;
          interview_type?: string;
          location?: string | null;
          meeting_link?: string | null;
          organization_id?: string | null;
          outcome?: string | null;
          round?: string;
          scheduled_at?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "interviews_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "interviews_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      job_requisitions: {
        Row: {
          approved_at: string | null;
          approved_by: string | null;
          closed_at: string | null;
          created_at: string;
          department_id: string | null;
          description: string | null;
          employment_type: string;
          experience_max: number | null;
          experience_min: number | null;
          hiring_manager_id: string | null;
          id: string;
          location_id: string | null;
          openings: number;
          organization_id: string | null;
          published_at: string | null;
          qualifications: string | null;
          requirements: string | null;
          responsibilities: string | null;
          salary_max: number | null;
          salary_min: number | null;
          skills: string[] | null;
          slug: string | null;
          status: string;
          title: string;
          work_mode: string | null;
        };
        Insert: {
          approved_at?: string | null;
          approved_by?: string | null;
          closed_at?: string | null;
          created_at?: string;
          department_id?: string | null;
          description?: string | null;
          employment_type?: string;
          experience_max?: number | null;
          experience_min?: number | null;
          hiring_manager_id?: string | null;
          id?: string;
          location_id?: string | null;
          openings?: number;
          organization_id?: string | null;
          published_at?: string | null;
          qualifications?: string | null;
          requirements?: string | null;
          responsibilities?: string | null;
          salary_max?: number | null;
          salary_min?: number | null;
          skills?: string[] | null;
          slug?: string | null;
          status?: string;
          title: string;
          work_mode?: string | null;
        };
        Update: {
          approved_at?: string | null;
          approved_by?: string | null;
          closed_at?: string | null;
          created_at?: string;
          department_id?: string | null;
          description?: string | null;
          employment_type?: string;
          experience_max?: number | null;
          experience_min?: number | null;
          hiring_manager_id?: string | null;
          id?: string;
          location_id?: string | null;
          openings?: number;
          organization_id?: string | null;
          published_at?: string | null;
          qualifications?: string | null;
          requirements?: string | null;
          responsibilities?: string | null;
          salary_max?: number | null;
          salary_min?: number | null;
          skills?: string[] | null;
          slug?: string | null;
          status?: string;
          title?: string;
          work_mode?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "job_requisitions_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "departments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_requisitions_hiring_manager_id_fkey";
            columns: ["hiring_manager_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_requisitions_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_requisitions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      kb_chunks: {
        Row: {
          chunk_index: number;
          content: string;
          content_hash: string | null;
          document_id: string;
          embedded_at: string | null;
          embedding: string | null;
          embedding_model: string | null;
          heading: string | null;
          id: string;
        };
        Insert: {
          chunk_index?: number;
          content: string;
          content_hash?: string | null;
          document_id: string;
          embedded_at?: string | null;
          embedding?: string | null;
          embedding_model?: string | null;
          heading?: string | null;
          id?: string;
        };
        Update: {
          chunk_index?: number;
          content?: string;
          content_hash?: string | null;
          document_id?: string;
          embedded_at?: string | null;
          embedding?: string | null;
          embedding_model?: string | null;
          heading?: string | null;
          id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "kb_chunks_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "kb_documents";
            referencedColumns: ["id"];
          },
        ];
      };
      kb_documents: {
        Row: {
          category: string;
          content: string;
          created_at: string;
          id: string;
          status: string;
          title: string;
          version: string | null;
        };
        Insert: {
          category?: string;
          content: string;
          created_at?: string;
          id?: string;
          status?: string;
          title: string;
          version?: string | null;
        };
        Update: {
          category?: string;
          content?: string;
          created_at?: string;
          id?: string;
          status?: string;
          title?: string;
          version?: string | null;
        };
        Relationships: [];
      };
      leave_balance_movements: {
        Row: {
          actor_id: string | null;
          amount: number;
          created_at: string;
          employee_id: string;
          id: string;
          leave_type_id: string | null;
          movement_type: string;
          note: string | null;
          year: number | null;
        };
        Insert: {
          actor_id?: string | null;
          amount?: number;
          created_at?: string;
          employee_id: string;
          id?: string;
          leave_type_id?: string | null;
          movement_type?: string;
          note?: string | null;
          year?: number | null;
        };
        Update: {
          actor_id?: string | null;
          amount?: number;
          created_at?: string;
          employee_id?: string;
          id?: string;
          leave_type_id?: string | null;
          movement_type?: string;
          note?: string | null;
          year?: number | null;
        };
        Relationships: [];
      };
      leave_balances: {
        Row: {
          employee_id: string;
          entitled: number;
          id: string;
          leave_type_id: string;
          used: number;
          year: number;
        };
        Insert: {
          employee_id: string;
          entitled?: number;
          id?: string;
          leave_type_id: string;
          used?: number;
          year?: number;
        };
        Update: {
          employee_id?: string;
          entitled?: number;
          id?: string;
          leave_type_id?: string;
          used?: number;
          year?: number;
        };
        Relationships: [
          {
            foreignKeyName: "leave_balances_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "leave_balances_leave_type_id_fkey";
            columns: ["leave_type_id"];
            isOneToOne: false;
            referencedRelation: "leave_types";
            referencedColumns: ["id"];
          },
        ];
      };
      leave_policies: {
        Row: {
          accrual_period: string;
          allow_half_day: boolean;
          allow_negative_balance: boolean;
          carry_forward_max: number;
          created_at: string;
          id: string;
          leave_type_id: string;
          max_consecutive_days: number | null;
          min_notice_days: number;
          requires_approval: boolean;
        };
        Insert: {
          accrual_period?: string;
          allow_half_day?: boolean;
          allow_negative_balance?: boolean;
          carry_forward_max?: number;
          created_at?: string;
          id?: string;
          leave_type_id: string;
          max_consecutive_days?: number | null;
          min_notice_days?: number;
          requires_approval?: boolean;
        };
        Update: {
          accrual_period?: string;
          allow_half_day?: boolean;
          allow_negative_balance?: boolean;
          carry_forward_max?: number;
          created_at?: string;
          id?: string;
          leave_type_id?: string;
          max_consecutive_days?: number | null;
          min_notice_days?: number;
          requires_approval?: boolean;
        };
        Relationships: [];
      };
      leave_requests: {
        Row: {
          approver_id: string | null;
          created_at: string;
          days: number;
          decided_at: string | null;
          decision_note: string | null;
          employee_id: string;
          end_date: string;
          half_day_part: string | null;
          id: string;
          is_half_day: boolean;
          leave_type_id: string;
          reason: string | null;
          start_date: string;
          status: string;
        };
        Insert: {
          approver_id?: string | null;
          created_at?: string;
          days?: number;
          decided_at?: string | null;
          decision_note?: string | null;
          employee_id: string;
          end_date: string;
          half_day_part?: string | null;
          id?: string;
          is_half_day?: boolean;
          leave_type_id: string;
          reason?: string | null;
          start_date: string;
          status?: string;
        };
        Update: {
          approver_id?: string | null;
          created_at?: string;
          days?: number;
          decided_at?: string | null;
          decision_note?: string | null;
          employee_id?: string;
          end_date?: string;
          half_day_part?: string | null;
          id?: string;
          is_half_day?: boolean;
          leave_type_id?: string;
          reason?: string | null;
          start_date?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "leave_requests_approver_id_fkey";
            columns: ["approver_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "leave_requests_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "leave_requests_leave_type_id_fkey";
            columns: ["leave_type_id"];
            isOneToOne: false;
            referencedRelation: "leave_types";
            referencedColumns: ["id"];
          },
        ];
      };
      leave_types: {
        Row: {
          annual_quota: number;
          code: string;
          id: string;
          name: string;
          organization_id: string | null;
          paid: boolean;
        };
        Insert: {
          annual_quota?: number;
          code: string;
          id?: string;
          name: string;
          organization_id?: string | null;
          paid?: boolean;
        };
        Update: {
          annual_quota?: number;
          code?: string;
          id?: string;
          name?: string;
          organization_id?: string | null;
          paid?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "leave_types_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      legal_entities: {
        Row: {
          code: string;
          created_at: string;
          id: string;
          name: string;
          organization_id: string;
          registration_number: string | null;
          status: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          id?: string;
          name: string;
          organization_id: string;
          registration_number?: string | null;
          status?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          id?: string;
          name?: string;
          organization_id?: string;
          registration_number?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "legal_entities_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      locations: {
        Row: {
          address: string | null;
          city: string | null;
          country: string | null;
          created_at: string;
          id: string;
          legal_entity_id: string | null;
          name: string;
          organization_id: string;
          status: string;
          timezone: string | null;
        };
        Insert: {
          address?: string | null;
          city?: string | null;
          country?: string | null;
          created_at?: string;
          id?: string;
          legal_entity_id?: string | null;
          name: string;
          organization_id: string;
          status?: string;
          timezone?: string | null;
        };
        Update: {
          address?: string | null;
          city?: string | null;
          country?: string | null;
          created_at?: string;
          id?: string;
          legal_entity_id?: string | null;
          name?: string;
          organization_id?: string;
          status?: string;
          timezone?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "locations_legal_entity_id_fkey";
            columns: ["legal_entity_id"];
            isOneToOne: false;
            referencedRelation: "legal_entities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "locations_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          body: string | null;
          category: string;
          created_at: string;
          id: string;
          link: string | null;
          read: boolean;
          title: string;
          user_id: string;
        };
        Insert: {
          body?: string | null;
          category?: string;
          created_at?: string;
          id?: string;
          link?: string | null;
          read?: boolean;
          title: string;
          user_id: string;
        };
        Update: {
          body?: string | null;
          category?: string;
          created_at?: string;
          id?: string;
          link?: string | null;
          read?: boolean;
          title?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      offboardings: {
        Row: {
          completed_at: string | null;
          completed_by: string | null;
          created_at: string;
          employee_id: string;
          exit_interview_notes: string | null;
          exit_type: string;
          final_settlement_note: string | null;
          id: string;
          initiated_by: string | null;
          last_working_day: string | null;
          notice_start_date: string;
          reason: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          completed_at?: string | null;
          completed_by?: string | null;
          created_at?: string;
          employee_id: string;
          exit_interview_notes?: string | null;
          exit_type?: string;
          final_settlement_note?: string | null;
          id?: string;
          initiated_by?: string | null;
          last_working_day?: string | null;
          notice_start_date?: string;
          reason?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          completed_at?: string | null;
          completed_by?: string | null;
          created_at?: string;
          employee_id?: string;
          exit_interview_notes?: string | null;
          exit_type?: string;
          final_settlement_note?: string | null;
          id?: string;
          initiated_by?: string | null;
          last_working_day?: string | null;
          notice_start_date?: string;
          reason?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      offers: {
        Row: {
          annual_ctc: number | null;
          application_id: string;
          approved_at: string | null;
          approved_by: string | null;
          created_at: string;
          created_by: string | null;
          currency: string | null;
          department_id: string | null;
          designation: string | null;
          employment_type: string;
          expires_on: string | null;
          id: string;
          location_id: string | null;
          organization_id: string | null;
          responded_at: string | null;
          response_note: string | null;
          sent_at: string | null;
          start_date: string | null;
          status: string;
        };
        Insert: {
          annual_ctc?: number | null;
          application_id: string;
          approved_at?: string | null;
          approved_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string | null;
          department_id?: string | null;
          designation?: string | null;
          employment_type?: string;
          expires_on?: string | null;
          id?: string;
          location_id?: string | null;
          organization_id?: string | null;
          responded_at?: string | null;
          response_note?: string | null;
          sent_at?: string | null;
          start_date?: string | null;
          status?: string;
        };
        Update: {
          annual_ctc?: number | null;
          application_id?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string | null;
          department_id?: string | null;
          designation?: string | null;
          employment_type?: string;
          expires_on?: string | null;
          id?: string;
          location_id?: string | null;
          organization_id?: string | null;
          responded_at?: string | null;
          response_note?: string | null;
          sent_at?: string | null;
          start_date?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "offers_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "offers_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "departments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "offers_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "offers_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      onboarding_tasks: {
        Row: {
          candidate_id: string | null;
          created_at: string;
          due_date: string | null;
          employee_id: string | null;
          id: string;
          owner: string | null;
          status: string;
          title: string;
        };
        Insert: {
          candidate_id?: string | null;
          created_at?: string;
          due_date?: string | null;
          employee_id?: string | null;
          id?: string;
          owner?: string | null;
          status?: string;
          title: string;
        };
        Update: {
          candidate_id?: string | null;
          created_at?: string;
          due_date?: string | null;
          employee_id?: string | null;
          id?: string;
          owner?: string | null;
          status?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "onboarding_tasks_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "onboarding_tasks_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      onboarding_templates: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          is_default: boolean;
          name: string;
          organization_id: string | null;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          is_default?: boolean;
          name: string;
          organization_id?: string | null;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          is_default?: boolean;
          name?: string;
          organization_id?: string | null;
        };
        Relationships: [];
      };
      onboarding_template_tasks: {
        Row: {
          due_in_days: number;
          id: string;
          owner: string;
          sort_order: number;
          template_id: string;
          title: string;
        };
        Insert: {
          due_in_days?: number;
          id?: string;
          owner?: string;
          sort_order?: number;
          template_id: string;
          title: string;
        };
        Update: {
          due_in_days?: number;
          id?: string;
          owner?: string;
          sort_order?: number;
          template_id?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "onboarding_template_tasks_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "onboarding_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          code: string;
          created_at: string;
          currency: string | null;
          id: string;
          industry: string | null;
          name: string;
          status: string;
          timezone: string | null;
        };
        Insert: {
          code: string;
          created_at?: string;
          currency?: string | null;
          id?: string;
          industry?: string | null;
          name: string;
          status?: string;
          timezone?: string | null;
        };
        Update: {
          code?: string;
          created_at?: string;
          currency?: string | null;
          id?: string;
          industry?: string | null;
          name?: string;
          status?: string;
          timezone?: string | null;
        };
        Relationships: [];
      };
      performance_cycles: {
        Row: {
          created_at: string;
          end_date: string | null;
          id: string;
          name: string;
          organization_id: string | null;
          period: string;
          review_end_date: string | null;
          review_start_date: string | null;
          self_review_required: boolean;
          start_date: string;
          status: string;
        };
        Insert: {
          created_at?: string;
          end_date?: string | null;
          id?: string;
          name: string;
          organization_id?: string | null;
          period: string;
          review_end_date?: string | null;
          review_start_date?: string | null;
          self_review_required?: boolean;
          start_date?: string;
          status?: string;
        };
        Update: {
          created_at?: string;
          end_date?: string | null;
          id?: string;
          name?: string;
          organization_id?: string | null;
          period?: string;
          review_end_date?: string | null;
          review_start_date?: string | null;
          self_review_required?: boolean;
          start_date?: string;
          status?: string;
        };
        Relationships: [];
      };
      performance_reviews: {
        Row: {
          created_at: string;
          cycle_id: string | null;
          employee_id: string;
          finalized_at: string | null;
          finalized_by: string | null;
          id: string;
          improvements: string | null;
          period: string;
          rating: number | null;
          reviewer_id: string | null;
          self_improvements: string | null;
          self_rating: number | null;
          self_strengths: string | null;
          self_submitted_at: string | null;
          self_summary: string | null;
          status: string;
          strengths: string | null;
          submitted_at: string | null;
          summary: string | null;
        };
        Insert: {
          created_at?: string;
          cycle_id?: string | null;
          employee_id: string;
          finalized_at?: string | null;
          finalized_by?: string | null;
          id?: string;
          improvements?: string | null;
          period: string;
          rating?: number | null;
          reviewer_id?: string | null;
          self_improvements?: string | null;
          self_rating?: number | null;
          self_strengths?: string | null;
          self_submitted_at?: string | null;
          self_summary?: string | null;
          status?: string;
          strengths?: string | null;
          submitted_at?: string | null;
          summary?: string | null;
        };
        Update: {
          created_at?: string;
          cycle_id?: string | null;
          employee_id?: string;
          finalized_at?: string | null;
          finalized_by?: string | null;
          id?: string;
          improvements?: string | null;
          period?: string;
          rating?: number | null;
          reviewer_id?: string | null;
          self_improvements?: string | null;
          self_rating?: number | null;
          self_strengths?: string | null;
          self_submitted_at?: string | null;
          self_summary?: string | null;
          status?: string;
          strengths?: string | null;
          submitted_at?: string | null;
          summary?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "performance_reviews_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "performance_reviews_reviewer_id_fkey";
            columns: ["reviewer_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      permissions: {
        Row: {
          category: string;
          code: string;
          created_at: string;
          label: string;
          sensitive: boolean;
        };
        Insert: {
          category?: string;
          code: string;
          created_at?: string;
          label: string;
          sensitive?: boolean;
        };
        Update: {
          category?: string;
          code?: string;
          created_at?: string;
          label?: string;
          sensitive?: boolean;
        };
        Relationships: [];
      };
      payroll_entries: {
        Row: {
          allowances: number;
          basic: number;
          created_at: string;
          deductions: number;
          employee_id: string;
          gross: number;
          id: string;
          net: number;
          notes: string | null;
          run_id: string;
          status: string;
        };
        Insert: {
          allowances?: number;
          basic?: number;
          created_at?: string;
          deductions?: number;
          employee_id: string;
          gross?: number;
          id?: string;
          net?: number;
          notes?: string | null;
          run_id: string;
          status?: string;
        };
        Update: {
          allowances?: number;
          basic?: number;
          created_at?: string;
          deductions?: number;
          employee_id?: string;
          gross?: number;
          id?: string;
          net?: number;
          notes?: string | null;
          run_id?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payroll_entries_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payroll_entries_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "payroll_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      payroll_runs: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          organization_id: string | null;
          paid_at: string | null;
          paid_by: string | null;
          period_end: string;
          period_start: string;
          processed_at: string | null;
          status: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          organization_id?: string | null;
          paid_at?: string | null;
          paid_by?: string | null;
          period_end: string;
          period_start: string;
          processed_at?: string | null;
          status?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          organization_id?: string | null;
          paid_at?: string | null;
          paid_by?: string | null;
          period_end?: string;
          period_start?: string;
          processed_at?: string | null;
          status?: string;
        };
        Relationships: [];
      };
      profile_change_requests: {
        Row: {
          approver_id: string | null;
          created_at: string;
          current_value: string | null;
          decided_at: string | null;
          decision_note: string | null;
          employee_id: string;
          field: string;
          id: string;
          reason: string | null;
          requested_value: string;
          status: string;
        };
        Insert: {
          approver_id?: string | null;
          created_at?: string;
          current_value?: string | null;
          decided_at?: string | null;
          decision_note?: string | null;
          employee_id: string;
          field: string;
          id?: string;
          reason?: string | null;
          requested_value: string;
          status?: string;
        };
        Update: {
          approver_id?: string | null;
          created_at?: string;
          current_value?: string | null;
          decided_at?: string | null;
          decision_note?: string | null;
          employee_id?: string;
          field?: string;
          id?: string;
          reason?: string | null;
          requested_value?: string;
          status?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          email: string | null;
          full_name: string | null;
          id: string;
          last_login: string | null;
          status: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id: string;
          last_login?: string | null;
          status?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id?: string;
          last_login?: string | null;
          status?: string;
        };
        Relationships: [];
      };
      role_permissions: {
        Row: {
          created_at: string;
          id: string;
          permission_code: string;
          role: Database["public"]["Enums"]["app_role"];
        };
        Insert: {
          created_at?: string;
          id?: string;
          permission_code: string;
          role: Database["public"]["Enums"]["app_role"];
        };
        Update: {
          created_at?: string;
          id?: string;
          permission_code?: string;
          role?: Database["public"]["Enums"]["app_role"];
        };
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_code_fkey";
            columns: ["permission_code"];
            isOneToOne: false;
            referencedRelation: "permissions";
            referencedColumns: ["code"];
          },
        ];
      };
      shifts: {
        Row: {
          break_minutes: number;
          code: string;
          created_at: string;
          days_of_week: number[];
          end_time: string;
          grace_minutes: number;
          half_day_hours: number;
          id: string;
          minimum_hours: number;
          name: string;
          organization_id: string | null;
          overtime_after_minutes: number;
          overnight: boolean;
          start_time: string;
          status: string;
          updated_at: string;
          weekly_overtime_after_minutes: number;
        };
        Insert: {
          break_minutes?: number;
          code: string;
          created_at?: string;
          days_of_week?: number[];
          end_time: string;
          grace_minutes?: number;
          half_day_hours?: number;
          id?: string;
          minimum_hours?: number;
          name: string;
          organization_id?: string | null;
          overtime_after_minutes?: number;
          overnight?: boolean;
          start_time: string;
          status?: string;
          updated_at?: string;
          weekly_overtime_after_minutes?: number;
        };
        Update: {
          break_minutes?: number;
          code?: string;
          created_at?: string;
          days_of_week?: number[];
          end_time?: string;
          grace_minutes?: number;
          half_day_hours?: number;
          id?: string;
          minimum_hours?: number;
          name?: string;
          organization_id?: string | null;
          overtime_after_minutes?: number;
          overnight?: boolean;
          start_time?: string;
          status?: string;
          updated_at?: string;
          weekly_overtime_after_minutes?: number;
        };
        Relationships: [];
      };
      ticket_attachments: {
        Row: {
          created_at: string;
          file_path: string;
          id: string;
          name: string;
          ticket_id: string;
          uploaded_by: string | null;
        };
        Insert: {
          created_at?: string;
          file_path: string;
          id?: string;
          name: string;
          ticket_id: string;
          uploaded_by?: string | null;
        };
        Update: {
          created_at?: string;
          file_path?: string;
          id?: string;
          name?: string;
          ticket_id?: string;
          uploaded_by?: string | null;
        };
        Relationships: [];
      };
      ticket_comments: {
        Row: {
          author_id: string | null;
          body: string;
          created_at: string;
          id: string;
          ticket_id: string;
        };
        Insert: {
          author_id?: string | null;
          body: string;
          created_at?: string;
          id?: string;
          ticket_id: string;
        };
        Update: {
          author_id?: string | null;
          body?: string;
          created_at?: string;
          id?: string;
          ticket_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ticket_comments_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "helpdesk_tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      ticket_internal_notes: {
        Row: {
          author_id: string | null;
          body: string;
          created_at: string;
          id: string;
          ticket_id: string;
        };
        Insert: {
          author_id?: string | null;
          body: string;
          created_at?: string;
          id?: string;
          ticket_id: string;
        };
        Update: {
          author_id?: string | null;
          body?: string;
          created_at?: string;
          id?: string;
          ticket_id?: string;
        };
        Relationships: [];
      };
      ticket_status_history: {
        Row: {
          changed_by: string | null;
          created_at: string;
          from_status: string | null;
          id: string;
          note: string | null;
          ticket_id: string;
          to_status: string;
        };
        Insert: {
          changed_by?: string | null;
          created_at?: string;
          from_status?: string | null;
          id?: string;
          note?: string | null;
          ticket_id: string;
          to_status: string;
        };
        Update: {
          changed_by?: string | null;
          created_at?: string;
          from_status?: string | null;
          id?: string;
          note?: string | null;
          ticket_id?: string;
          to_status?: string;
        };
        Relationships: [];
      };
      training_programs: {
        Row: {
          category: string;
          created_at: string;
          description: string | null;
          duration_hours: number | null;
          external_url: string | null;
          id: string;
          mode: string;
          organization_id: string | null;
          provider: string | null;
          status: string;
          title: string;
        };
        Insert: {
          category?: string;
          created_at?: string;
          description?: string | null;
          duration_hours?: number | null;
          external_url?: string | null;
          id?: string;
          mode?: string;
          organization_id?: string | null;
          provider?: string | null;
          status?: string;
          title: string;
        };
        Update: {
          category?: string;
          created_at?: string;
          description?: string | null;
          duration_hours?: number | null;
          external_url?: string | null;
          id?: string;
          mode?: string;
          organization_id?: string | null;
          provider?: string | null;
          status?: string;
          title?: string;
        };
        Relationships: [];
      };
      training_sessions: {
        Row: {
          created_at: string;
          ends_on: string | null;
          id: string;
          instructor: string | null;
          location: string | null;
          program_id: string;
          starts_on: string | null;
          title: string;
        };
        Insert: {
          created_at?: string;
          ends_on?: string | null;
          id?: string;
          instructor?: string | null;
          location?: string | null;
          program_id: string;
          starts_on?: string | null;
          title: string;
        };
        Update: {
          created_at?: string;
          ends_on?: string | null;
          id?: string;
          instructor?: string | null;
          location?: string | null;
          program_id?: string;
          starts_on?: string | null;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "training_sessions_program_id_fkey";
            columns: ["program_id"];
            isOneToOne: false;
            referencedRelation: "training_programs";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          scope: Database["public"]["Enums"]["data_scope"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          scope?: Database["public"]["Enums"]["data_scope"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          scope?: Database["public"]["Enums"]["data_scope"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      can_manage_employee: {
        Args: { _employee_id: string; _user_id: string };
        Returns: boolean;
      };
      can_place_employee: {
        Args: {
          _department_id: string;
          _legal_entity_id: string;
          _location_id: string;
          _organization_id: string;
          _user_id: string;
        };
        Returns: boolean;
      };
      can_view_employee: {
        Args: { _employee_id: string; _user_id: string };
        Returns: boolean;
      };
      current_employee_id: { Args: { _user_id: string }; Returns: string };
      current_organization_id: { Args: { _user_id: string }; Returns: string };
      has_permission: {
        Args: { _code: string; _user_id: string };
        Returns: boolean;
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      in_my_org: {
        Args: { _organization_id: string; _user_id: string };
        Returns: boolean;
      };
      is_admin: { Args: { _user_id: string }; Returns: boolean };
      is_hr: { Args: { _user_id: string }; Returns: boolean };
      is_manager: {
        Args: { _user_id: string };
        Returns: boolean;
      };
      is_self_employee: {
        Args: { _employee_id: string; _user_id: string };
        Returns: boolean;
      };
      match_kb_chunks: {
        Args: {
          match_count?: number;
          query_embedding: string;
          similarity_threshold?: number;
        };
        Returns: {
          chunk_id: string;
          content: string;
          document_id: string;
          document_title: string;
          heading: string;
          similarity: number;
        }[];
      };
      public_job_detail: {
        Args: { _slug: string };
        Returns: {
          city: string;
          country: string;
          department: string;
          description: string;
          employment_type: string;
          experience_max: number;
          experience_min: number;
          location: string;
          openings: number;
          published_at: string;
          qualifications: string;
          requirements: string;
          responsibilities: string;
          skills: string[];
          slug: string;
          title: string;
          work_mode: string;
        }[];
      };
      public_job_list: {
        Args: never;
        Returns: {
          city: string;
          country: string;
          department: string;
          description: string;
          employment_type: string;
          experience_max: number;
          experience_min: number;
          location: string;
          published_at: string;
          skills: string[];
          slug: string;
          title: string;
          work_mode: string;
        }[];
      };
      reports_of: {
        Args: { _manager_employee_id: string };
        Returns: {
          id: string;
        }[];
      };
      user_scope: {
        Args: { _user_id: string };
        Returns: Database["public"]["Enums"]["data_scope"];
      };
    };
    Enums: {
      app_role: "super_admin" | "hr_admin" | "hr_staff" | "manager" | "employee";
      data_scope:
        | "SELF"
        | "DIRECT_REPORTS"
        | "DEPARTMENT"
        | "LOCATION"
        | "LEGAL_ENTITY"
        | "ORGANIZATION"
        | "GLOBAL";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["super_admin", "hr_admin", "hr_staff", "manager", "employee"],
      data_scope: [
        "SELF",
        "DIRECT_REPORTS",
        "DEPARTMENT",
        "LOCATION",
        "LEGAL_ENTITY",
        "ORGANIZATION",
        "GLOBAL",
      ],
    },
  },
} as const;
