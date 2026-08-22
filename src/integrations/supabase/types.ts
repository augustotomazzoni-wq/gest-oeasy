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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          new_values: Json | null
          old_values: Json | null
          organization_id: string
          record_id: string | null
          table_name: string | null
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          organization_id: string
          record_id?: string | null
          table_name?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          organization_id?: string
          record_id?: string | null
          table_name?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_accounts: {
        Row: {
          account: string | null
          active: boolean
          bank: string | null
          branch: string | null
          color: string
          created_at: string
          created_by: string | null
          id: string
          initial_balance: number
          initial_balance_date: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          account?: string | null
          active?: boolean
          bank?: string | null
          branch?: string | null
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          initial_balance?: number
          initial_balance_date?: string
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          account?: string | null
          active?: boolean
          bank?: string | null
          branch?: string | null
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          initial_balance?: number
          initial_balance_date?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cases: {
        Row: {
          action_type: string | null
          case_number: string | null
          client_id: string
          court: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          external_link: string | null
          id: string
          notes: string | null
          opposing_party: string | null
          organization_id: string
          practice_area: string | null
          responsible_lawyer: string | null
          result_center: string | null
          status: string
          updated_at: string
        }
        Insert: {
          action_type?: string | null
          case_number?: string | null
          client_id: string
          court?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          external_link?: string | null
          id?: string
          notes?: string | null
          opposing_party?: string | null
          organization_id: string
          practice_area?: string | null
          responsible_lawyer?: string | null
          result_center?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          action_type?: string | null
          case_number?: string | null
          client_id?: string
          court?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          external_link?: string | null
          id?: string
          notes?: string | null
          opposing_party?: string | null
          organization_id?: string
          practice_area?: string | null
          responsible_lawyer?: string | null
          result_center?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cases_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_balances"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "cases_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          active: boolean
          color: string
          created_at: string
          id: string
          name: string
          organization_id: string
          parent_id: string | null
          type: Database["public"]["Enums"]["category_type"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          color?: string
          created_at?: string
          id?: string
          name: string
          organization_id: string
          parent_id?: string | null
          type: Database["public"]["Enums"]["category_type"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          color?: string
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          parent_id?: string | null
          type?: Database["public"]["Enums"]["category_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      client_payment_accounts: {
        Row: {
          account: string | null
          bank: string | null
          branch: string | null
          client_id: string
          created_at: string
          created_by: string | null
          holder_name: string | null
          holder_tax_id: string | null
          id: string
          organization_id: string
          pix_key: string | null
          pix_key_type: string | null
          updated_at: string
        }
        Insert: {
          account?: string | null
          bank?: string | null
          branch?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          holder_name?: string | null
          holder_tax_id?: string | null
          id?: string
          organization_id: string
          pix_key?: string | null
          pix_key_type?: string | null
          updated_at?: string
        }
        Update: {
          account?: string | null
          bank?: string | null
          branch?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          holder_name?: string | null
          holder_tax_id?: string | null
          id?: string
          organization_id?: string
          pix_key?: string | null
          pix_key_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_payment_accounts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_payment_accounts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_balances"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_payment_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_transfers: {
        Row: {
          amount: number
          bank_account_id: string | null
          case_id: string | null
          client_id: string
          created_at: string
          created_by: string | null
          destination_info: string | null
          id: string
          notes: string | null
          organization_id: string
          override_reason: string | null
          paid_on: string | null
          receipt_file_url: string | null
          receipt_id: string | null
          receivable_id: string | null
          scheduled_for: string | null
          status: Database["public"]["Enums"]["transfer_status"]
          updated_at: string
        }
        Insert: {
          amount: number
          bank_account_id?: string | null
          case_id?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          destination_info?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          override_reason?: string | null
          paid_on?: string | null
          receipt_file_url?: string | null
          receipt_id?: string | null
          receivable_id?: string | null
          scheduled_for?: string | null
          status?: Database["public"]["Enums"]["transfer_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          bank_account_id?: string | null
          case_id?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          destination_info?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          override_reason?: string | null
          paid_on?: string | null
          receipt_file_url?: string | null
          receipt_id?: string | null
          receivable_id?: string | null
          scheduled_for?: string | null
          status?: Database["public"]["Enums"]["transfer_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_transfers_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_transfers_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_bank_balances"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "client_transfers_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_transfers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_transfers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_balances"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_transfers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_transfers_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_transfers_receivable_id_fkey"
            columns: ["receivable_id"]
            isOneToOne: false
            referencedRelation: "legal_receivables"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          email: string | null
          id: string
          name: string
          notes: string | null
          organization_id: string
          phone: string | null
          status: string
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          organization_id: string
          phone?: string | null
          status?: string
          tax_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          organization_id?: string
          phone?: string | null
          status?: string
          tax_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_transactions: {
        Row: {
          amount: number
          attachment_url: string | null
          bank_account_id: string | null
          case_id: string | null
          category_id: string | null
          client_id: string | null
          competence_date: string | null
          created_at: string
          created_by: string | null
          description: string
          due_date: string | null
          id: string
          organization_id: string
          paid_on: string | null
          source_id: string | null
          source_type: string | null
          status: Database["public"]["Enums"]["tx_status"]
          type: Database["public"]["Enums"]["tx_type"]
          updated_at: string
        }
        Insert: {
          amount: number
          attachment_url?: string | null
          bank_account_id?: string | null
          case_id?: string | null
          category_id?: string | null
          client_id?: string | null
          competence_date?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          due_date?: string | null
          id?: string
          organization_id: string
          paid_on?: string | null
          source_id?: string | null
          source_type?: string | null
          status?: Database["public"]["Enums"]["tx_status"]
          type: Database["public"]["Enums"]["tx_type"]
          updated_at?: string
        }
        Update: {
          amount?: number
          attachment_url?: string | null
          bank_account_id?: string | null
          case_id?: string | null
          category_id?: string | null
          client_id?: string | null
          competence_date?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          due_date?: string | null
          id?: string
          organization_id?: string
          paid_on?: string | null
          source_id?: string | null
          source_type?: string | null
          status?: Database["public"]["Enums"]["tx_status"]
          type?: Database["public"]["Enums"]["tx_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_transactions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_transactions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_bank_balances"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "financial_transactions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_transactions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_transactions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_balances"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "financial_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      installments: {
        Row: {
          cancel_reason: string | null
          canceled_at: string | null
          client_amount: number
          cost_reimbursement: number
          created_at: string
          created_by: string | null
          due_date: string | null
          fee_amount: number
          gross_amount: number
          id: string
          label: string | null
          notes: string | null
          number: number
          organization_id: string
          receivable_id: string
          review_pending: boolean
          success_fee_amount: number
          total_count: number
          updated_at: string
        }
        Insert: {
          cancel_reason?: string | null
          canceled_at?: string | null
          client_amount?: number
          cost_reimbursement?: number
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          fee_amount?: number
          gross_amount?: number
          id?: string
          label?: string | null
          notes?: string | null
          number?: number
          organization_id: string
          receivable_id: string
          review_pending?: boolean
          success_fee_amount?: number
          total_count?: number
          updated_at?: string
        }
        Update: {
          cancel_reason?: string | null
          canceled_at?: string | null
          client_amount?: number
          cost_reimbursement?: number
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          fee_amount?: number
          gross_amount?: number
          id?: string
          label?: string | null
          notes?: string | null
          number?: number
          organization_id?: string
          receivable_id?: string
          review_pending?: boolean
          success_fee_amount?: number
          total_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "installments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installments_receivable_id_fkey"
            columns: ["receivable_id"]
            isOneToOne: false
            referencedRelation: "legal_receivables"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_receivables: {
        Row: {
          agreement_date: string | null
          case_id: string | null
          client_id: string
          cost_reimbursement: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          expected_client_amount: number
          expected_firm_amount: number
          fee_fixed_amount: number | null
          fee_percent: number | null
          flow: Database["public"]["Enums"]["flow_type"]
          gross_amount: number
          id: string
          is_estimated: boolean
          manual_override_reason: string | null
          notes: string | null
          organization_id: string
          review_pending: boolean
          status: Database["public"]["Enums"]["receivable_status"]
          success_fee_amount: number
          type: Database["public"]["Enums"]["receivable_type"]
          updated_at: string
        }
        Insert: {
          agreement_date?: string | null
          case_id?: string | null
          client_id: string
          cost_reimbursement?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          expected_client_amount?: number
          expected_firm_amount?: number
          fee_fixed_amount?: number | null
          fee_percent?: number | null
          flow?: Database["public"]["Enums"]["flow_type"]
          gross_amount?: number
          id?: string
          is_estimated?: boolean
          manual_override_reason?: string | null
          notes?: string | null
          organization_id: string
          review_pending?: boolean
          status?: Database["public"]["Enums"]["receivable_status"]
          success_fee_amount?: number
          type?: Database["public"]["Enums"]["receivable_type"]
          updated_at?: string
        }
        Update: {
          agreement_date?: string | null
          case_id?: string | null
          client_id?: string
          cost_reimbursement?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          expected_client_amount?: number
          expected_firm_amount?: number
          fee_fixed_amount?: number | null
          fee_percent?: number | null
          flow?: Database["public"]["Enums"]["flow_type"]
          gross_amount?: number
          id?: string
          is_estimated?: boolean
          manual_override_reason?: string | null
          notes?: string | null
          organization_id?: string
          review_pending?: boolean
          status?: Database["public"]["Enums"]["receivable_status"]
          success_fee_amount?: number
          type?: Database["public"]["Enums"]["receivable_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_receivables_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_receivables_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_receivables_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_balances"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "legal_receivables_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address: string | null
          brand_color: string
          cnpj: string | null
          created_at: string
          currency: string
          id: string
          logo_url: string | null
          name: string
          timezone: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          brand_color?: string
          cnpj?: string | null
          created_at?: string
          currency?: string
          id?: string
          logo_url?: string | null
          name: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          brand_color?: string
          cnpj?: string | null
          created_at?: string
          currency?: string
          id?: string
          logo_url?: string | null
          name?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active: boolean
          confirmed_at: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          invited_at: string | null
          last_sign_in_at: string | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          confirmed_at?: string | null
          created_at?: string
          email: string
          full_name?: string
          id: string
          invited_at?: string | null
          last_sign_in_at?: string | null
          organization_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          confirmed_at?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          invited_at?: string | null
          last_sign_in_at?: string | null
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      receipts: {
        Row: {
          bank_account_id: string | null
          client_amount: number
          cost_reimbursement: number
          created_at: string
          created_by: string | null
          fee_amount: number
          id: string
          installment_id: string
          notes: string | null
          organization_id: string
          payment_method: string | null
          received_on: string
          reconciled: boolean
          reference: string | null
          success_fee_amount: number
          total_amount: number
          updated_at: string
        }
        Insert: {
          bank_account_id?: string | null
          client_amount?: number
          cost_reimbursement?: number
          created_at?: string
          created_by?: string | null
          fee_amount?: number
          id?: string
          installment_id: string
          notes?: string | null
          organization_id: string
          payment_method?: string | null
          received_on?: string
          reconciled?: boolean
          reference?: string | null
          success_fee_amount?: number
          total_amount: number
          updated_at?: string
        }
        Update: {
          bank_account_id?: string | null
          client_amount?: number
          cost_reimbursement?: number
          created_at?: string
          created_by?: string | null
          fee_amount?: number
          id?: string
          installment_id?: string
          notes?: string | null
          organization_id?: string
          payment_method?: string | null
          received_on?: string
          reconciled?: boolean
          reference?: string | null
          success_fee_amount?: number
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipts_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_bank_balances"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "receipts_installment_id_fkey"
            columns: ["installment_id"]
            isOneToOne: false
            referencedRelation: "installments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_installment_id_fkey"
            columns: ["installment_id"]
            isOneToOne: false
            referencedRelation: "v_installments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
      v_bank_balances: {
        Row: {
          balance: number | null
          bank_account_id: string | null
          color: string | null
          name: string | null
          organization_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      v_client_balances: {
        Row: {
          client_id: string | null
          name: string | null
          organization_id: string | null
          pending_transfer: number | null
          received_client: number | null
          transferred: number | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      v_installments: {
        Row: {
          balance: number | null
          cancel_reason: string | null
          canceled_at: string | null
          case_id: string | null
          client_amount: number | null
          client_id: string | null
          cost_reimbursement: number | null
          created_at: string | null
          created_by: string | null
          due_date: string | null
          fee_amount: number | null
          gross_amount: number | null
          id: string | null
          is_estimated: boolean | null
          label: string | null
          notes: string | null
          number: number | null
          organization_id: string | null
          paid_client: number | null
          paid_fee: number | null
          paid_success_fee: number | null
          paid_total: number | null
          receivable_id: string | null
          receivable_status:
            | Database["public"]["Enums"]["receivable_status"]
            | null
          receivable_type: Database["public"]["Enums"]["receivable_type"] | null
          review_pending: boolean | null
          status: string | null
          success_fee_amount: number | null
          total_count: number | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "installments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installments_receivable_id_fkey"
            columns: ["receivable_id"]
            isOneToOne: false
            referencedRelation: "legal_receivables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_receivables_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_receivables_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_receivables_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_balances"
            referencedColumns: ["client_id"]
          },
        ]
      }
    }
    Functions: {
      can_write: { Args: never; Returns: boolean }
      current_org_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_org_member: { Args: { _org: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "financeiro" | "advogado" | "consulta"
      category_type: "receita" | "despesa"
      flow_type:
        | "escritorio_recebe_total"
        | "cliente_recebe_direto"
        | "recebimento_dividido"
        | "deposito_judicial"
      receivable_status:
        | "rascunho"
        | "estimado"
        | "confirmado"
        | "em_pagamento"
        | "em_execucao"
        | "encerrado"
        | "cancelado"
      receivable_type:
        | "acordo"
        | "sentenca"
        | "execucao"
        | "honorarios"
        | "outro"
      transfer_status: "pendente" | "agendado" | "pago" | "cancelado"
      tx_status: "previsto" | "pago" | "cancelado"
      tx_type:
        | "entrada"
        | "saida"
        | "transferencia_entre_contas"
        | "entrada_de_terceiros"
        | "repasse_de_terceiros"
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
      app_role: ["admin", "financeiro", "advogado", "consulta"],
      category_type: ["receita", "despesa"],
      flow_type: [
        "escritorio_recebe_total",
        "cliente_recebe_direto",
        "recebimento_dividido",
        "deposito_judicial",
      ],
      receivable_status: [
        "rascunho",
        "estimado",
        "confirmado",
        "em_pagamento",
        "em_execucao",
        "encerrado",
        "cancelado",
      ],
      receivable_type: [
        "acordo",
        "sentenca",
        "execucao",
        "honorarios",
        "outro",
      ],
      transfer_status: ["pendente", "agendado", "pago", "cancelado"],
      tx_status: ["previsto", "pago", "cancelado"],
      tx_type: [
        "entrada",
        "saida",
        "transferencia_entre_contas",
        "entrada_de_terceiros",
        "repasse_de_terceiros",
      ],
    },
  },
} as const
