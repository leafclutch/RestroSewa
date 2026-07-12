export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      restaurants: {
        Row: {
          id: string;
          name: string;
          slug: string;
          type: Database["public"]["Enums"]["restaurant_type"];
          is_active: boolean;
          subscription_tier: Database["public"]["Enums"]["subscription_tier"];
          subscription_expires_at: string | null;
          settings: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          type?: Database["public"]["Enums"]["restaurant_type"];
          is_active?: boolean;
          subscription_tier?: Database["public"]["Enums"]["subscription_tier"];
          subscription_expires_at?: string | null;
          settings?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          type?: Database["public"]["Enums"]["restaurant_type"];
          is_active?: boolean;
          subscription_tier?: Database["public"]["Enums"]["subscription_tier"];
          subscription_expires_at?: string | null;
          settings?: Json;
          created_at?: string;
        };
      };

      super_admins: {
        Row: {
          id: string;
          auth_user_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          auth_user_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          auth_user_id?: string;
          created_at?: string;
        };
      };

      restaurant_users: {
        Row: {
          id: string;
          restaurant_id: string;
          auth_user_id: string | null;
          display_name: string;
          title: string;
          role: Database["public"]["Enums"]["user_role"];
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          restaurant_id: string;
          auth_user_id?: string | null;
          display_name: string;
          title?: string;
          role?: Database["public"]["Enums"]["user_role"];
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          restaurant_id?: string;
          auth_user_id?: string | null;
          display_name?: string;
          title?: string;
          role?: Database["public"]["Enums"]["user_role"];
          is_active?: boolean;
          created_at?: string;
        };
      };

      workstations: {
        Row: {
          id: string;
          restaurant_id: string;
          name: string;
          display_color: string | null;
          sort_order: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          restaurant_id: string;
          name: string;
          display_color?: string | null;
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          restaurant_id?: string;
          name?: string;
          display_color?: string | null;
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
        };
      };

      restaurant_user_workstations: {
        Row: {
          restaurant_user_id: string;
          workstation_id: string;
        };
        Insert: {
          restaurant_user_id: string;
          workstation_id: string;
        };
        Update: {
          restaurant_user_id?: string;
          workstation_id?: string;
        };
      };

      table_groups: {
        Row: {
          id: string;
          restaurant_id: string;
          name: string;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          restaurant_id: string;
          name: string;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          restaurant_id?: string;
          name?: string;
          sort_order?: number;
          created_at?: string;
        };
      };

      restaurant_tables: {
        Row: {
          id: string;
          restaurant_id: string;
          group_id: string | null;
          number: string;
          qr_token: string;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          restaurant_id: string;
          group_id?: string | null;
          number: string;
          qr_token?: string;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          restaurant_id?: string;
          group_id?: string | null;
          number?: string;
          qr_token?: string;
          is_active?: boolean;
          created_at?: string;
        };
      };

      room_types: {
        Row: {
          id: string;
          restaurant_id: string;
          name: string;
          description: string | null;
          base_price: number;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          restaurant_id: string;
          name: string;
          description?: string | null;
          base_price?: number;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          restaurant_id?: string;
          name?: string;
          description?: string | null;
          base_price?: number;
          sort_order?: number;
          created_at?: string;
        };
      };

      rooms: {
        Row: {
          id: string;
          restaurant_id: string;
          room_type_id: string;
          number: string;
          qr_token: string;
          status: Database["public"]["Enums"]["room_status"];
          created_at: string;
        };
        Insert: {
          id?: string;
          restaurant_id: string;
          room_type_id: string;
          number: string;
          qr_token?: string;
          status?: Database["public"]["Enums"]["room_status"];
          created_at?: string;
        };
        Update: {
          id?: string;
          restaurant_id?: string;
          room_type_id?: string;
          number?: string;
          qr_token?: string;
          status?: Database["public"]["Enums"]["room_status"];
          created_at?: string;
        };
      };

      room_stays: {
        Row: {
          id: string;
          restaurant_id: string;
          room_id: string;
          guest_name: string;
          guest_phone: string | null;
          guest_count: number;
          room_rate: number;
          check_in_at: string;
          check_out_at: string | null;
          status: Database["public"]["Enums"]["room_stay_status"];
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          restaurant_id: string;
          room_id: string;
          guest_name: string;
          guest_phone?: string | null;
          guest_count?: number;
          room_rate: number;
          check_in_at?: string;
          check_out_at?: string | null;
          status?: Database["public"]["Enums"]["room_stay_status"];
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          restaurant_id?: string;
          room_id?: string;
          guest_name?: string;
          guest_phone?: string | null;
          guest_count?: number;
          room_rate?: number;
          check_in_at?: string;
          check_out_at?: string | null;
          status?: Database["public"]["Enums"]["room_stay_status"];
          notes?: string | null;
          created_at?: string;
        };
      };

      room_charges: {
        Row: {
          id: string;
          room_stay_id: string;
          restaurant_id: string;
          type: Database["public"]["Enums"]["room_charge_type"];
          description: string;
          amount: number;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          room_stay_id: string;
          restaurant_id: string;
          type?: Database["public"]["Enums"]["room_charge_type"];
          description: string;
          amount: number;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          room_stay_id?: string;
          restaurant_id?: string;
          type?: Database["public"]["Enums"]["room_charge_type"];
          description?: string;
          amount?: number;
          created_by?: string | null;
          created_at?: string;
        };
      };

      credit_customers: {
        Row: {
          id: string;
          restaurant_id: string;
          name: string;
          phone: string | null;
          balance: number;
          notes: string | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          restaurant_id: string;
          name: string;
          phone?: string | null;
          balance?: number;
          notes?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          restaurant_id?: string;
          name?: string;
          phone?: string | null;
          balance?: number;
          notes?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
      };

      menu_categories: {
        Row: {
          id: string;
          restaurant_id: string;
          workstation_id: string;
          name: string;
          description: string | null;
          image_url: string | null;
          is_active: boolean;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          restaurant_id: string;
          workstation_id: string;
          name: string;
          description?: string | null;
          image_url?: string | null;
          is_active?: boolean;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          restaurant_id?: string;
          workstation_id?: string;
          name?: string;
          description?: string | null;
          image_url?: string | null;
          is_active?: boolean;
          sort_order?: number;
          created_at?: string;
        };
      };

      menu_items: {
        Row: {
          id: string;
          restaurant_id: string;
          category_id: string;
          workstation_id: string;
          name: string;
          description: string | null;
          price: number;
          image_url: string | null;
          is_available: boolean;
          has_variants: boolean;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          restaurant_id: string;
          category_id: string;
          workstation_id: string;
          name: string;
          description?: string | null;
          price: number;
          image_url?: string | null;
          is_available?: boolean;
          has_variants?: boolean;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          restaurant_id?: string;
          category_id?: string;
          workstation_id?: string;
          name?: string;
          description?: string | null;
          price?: number;
          image_url?: string | null;
          is_available?: boolean;
          has_variants?: boolean;
          sort_order?: number;
          created_at?: string;
        };
      };

      menu_item_variants: {
        Row: {
          id: string;
          menu_item_id: string;
          name: string;
          price: number;
          is_available: boolean;
          sort_order: number;
        };
        Insert: {
          id?: string;
          menu_item_id: string;
          name: string;
          price: number;
          is_available?: boolean;
          sort_order?: number;
        };
        Update: {
          id?: string;
          menu_item_id?: string;
          name?: string;
          price?: number;
          is_available?: boolean;
          sort_order?: number;
        };
      };

      menu_item_addons: {
        Row: {
          id: string;
          menu_item_id: string;
          name: string;
          price: number;
          is_available: boolean;
          sort_order: number;
        };
        Insert: {
          id?: string;
          menu_item_id: string;
          name: string;
          price?: number;
          is_available?: boolean;
          sort_order?: number;
        };
        Update: {
          id?: string;
          menu_item_id?: string;
          name?: string;
          price?: number;
          is_available?: boolean;
          sort_order?: number;
        };
      };

      sessions: {
        Row: {
          id: string;
          restaurant_id: string;
          type: Database["public"]["Enums"]["session_type"];
          table_id: string | null;
          room_stay_id: string | null;
          credit_customer_id: string | null;
          status: Database["public"]["Enums"]["session_status"];
          opened_at: string;
          closed_at: string | null;
        };
        Insert: {
          id?: string;
          restaurant_id: string;
          type?: Database["public"]["Enums"]["session_type"];
          table_id?: string | null;
          room_stay_id?: string | null;
          credit_customer_id?: string | null;
          status?: Database["public"]["Enums"]["session_status"];
          opened_at?: string;
          closed_at?: string | null;
        };
        Update: {
          id?: string;
          restaurant_id?: string;
          type?: Database["public"]["Enums"]["session_type"];
          table_id?: string | null;
          room_stay_id?: string | null;
          credit_customer_id?: string | null;
          status?: Database["public"]["Enums"]["session_status"];
          opened_at?: string;
          closed_at?: string | null;
        };
      };

      session_orders: {
        Row: {
          id: string;
          session_id: string;
          restaurant_id: string;
          created_by: string | null;
          status: Database["public"]["Enums"]["order_status"];
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          restaurant_id: string;
          created_by?: string | null;
          status?: Database["public"]["Enums"]["order_status"];
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          restaurant_id?: string;
          created_by?: string | null;
          status?: Database["public"]["Enums"]["order_status"];
          notes?: string | null;
          created_at?: string;
        };
      };

      session_order_items: {
        Row: {
          id: string;
          order_id: string;
          menu_item_id: string | null;
          variant_id: string | null;
          workstation_id: string | null;
          item_name: string;
          item_price: number;
          workstation_name: string | null;
          quantity: number;
          item_status: Database["public"]["Enums"]["item_status"];
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          menu_item_id?: string | null;
          variant_id?: string | null;
          workstation_id?: string | null;
          item_name: string;
          item_price: number;
          workstation_name?: string | null;
          quantity?: number;
          item_status?: Database["public"]["Enums"]["item_status"];
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string;
          menu_item_id?: string | null;
          variant_id?: string | null;
          workstation_id?: string | null;
          item_name?: string;
          item_price?: number;
          workstation_name?: string | null;
          quantity?: number;
          item_status?: Database["public"]["Enums"]["item_status"];
          notes?: string | null;
          created_at?: string;
        };
      };

      payments: {
        Row: {
          id: string;
          restaurant_id: string;
          session_id: string | null;
          room_stay_id: string | null;
          amount: number;
          // What the customer actually handed over, by tender. On a `credit`
          // bill these sum to LESS than total_amount — the gap is the credit.
          cash_amount: number;
          online_amount: number;
          card_amount: number;
          total_amount: number | null;
          payment_method: Database["public"]["Enums"]["payment_method"];
          notes: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          restaurant_id: string;
          session_id?: string | null;
          room_stay_id?: string | null;
          amount: number;
          cash_amount?: number;
          online_amount?: number;
          card_amount?: number;
          total_amount?: number | null;
          payment_method?: Database["public"]["Enums"]["payment_method"];
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          restaurant_id?: string;
          session_id?: string | null;
          room_stay_id?: string | null;
          amount?: number;
          cash_amount?: number;
          online_amount?: number;
          card_amount?: number;
          total_amount?: number | null;
          payment_method?: Database["public"]["Enums"]["payment_method"];
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
      };

      // A bill closed with an unpaid balance. Linked to the session + payment it
      // came from — a credit is never a second bill.
      credits: {
        Row: {
          id: string;
          restaurant_id: string;
          seq_no: number;
          credit_number: string; // generated: CR-00001
          session_id: string | null;
          payment_id: string | null;
          customer_name: string;
          customer_phone: string | null;
          bill_amount: number;
          down_payment: number;
          paid_amount: number;
          balance: number; // generated: bill_amount - paid_amount
          status: Database["public"]["Enums"]["credit_status"];
          notes: string | null;
          created_by: string | null;
          created_at: string;
          settled_at: string | null;
        };
        Insert: {
          id?: string;
          restaurant_id: string;
          seq_no: number;
          session_id?: string | null;
          payment_id?: string | null;
          customer_name: string;
          customer_phone?: string | null;
          bill_amount: number;
          down_payment?: number;
          paid_amount?: number;
          status?: Database["public"]["Enums"]["credit_status"];
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          settled_at?: string | null;
        };
        Update: {
          customer_name?: string;
          customer_phone?: string | null;
          paid_amount?: number;
          status?: Database["public"]["Enums"]["credit_status"];
          notes?: string | null;
          settled_at?: string | null;
        };
      };

      // Stock & Finance — a supplier, created once and reused for every purchase.
      // `credit_balance` is what WE owe THEM (a payable) — the mirror of `credits`.
      vendors: {
        Row: {
          id: string;
          restaurant_id: string;
          seq_no: number;
          vendor_code: string; // generated: VND-00001
          name: string;
          phone: string | null;
          address: string | null;
          notes: string | null;
          opening_credit: number;
          credit_balance: number;
          is_active: boolean;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          restaurant_id: string;
          seq_no: number;
          name: string;
          phone?: string | null;
          address?: string | null;
          notes?: string | null;
          opening_credit?: number;
          credit_balance?: number;
          is_active?: boolean;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          name?: string;
          phone?: string | null;
          address?: string | null;
          notes?: string | null;
          credit_balance?: number;
          is_active?: boolean;
        };
      };

      // Stock & Finance — a physical good bought and resold. Stock levels are
      // DERIVED (opening + purchases − POS usage ± adjustments), never stored.
      products: {
        Row: {
          id: string;
          restaurant_id: string;
          seq_no: number;
          product_code: string; // generated: PRD-00001
          name: string;
          unit: string;
          opening_stock: number;
          low_stock_threshold: number;
          last_unit_cost: number;
          is_active: boolean;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          restaurant_id: string;
          seq_no: number;
          name: string;
          unit: string;
          opening_stock?: number;
          low_stock_threshold?: number;
          last_unit_cost?: number;
          is_active?: boolean;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          name?: string;
          unit?: string;
          low_stock_threshold?: number;
          last_unit_cost?: number;
          is_active?: boolean;
        };
      };

      // What a menu item consumes when it sells. A true many-to-many junction:
      // one product feeds many menu items, and one menu item may consume several
      // products (a recipe). UNIQUE is on the (menu_item_id, product_id) PAIR.
      menu_item_products: {
        Row: {
          id: string;
          restaurant_id: string;
          menu_item_id: string;
          product_id: string;
          qty_per_unit: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          restaurant_id: string;
          menu_item_id: string;
          product_id: string;
          qty_per_unit?: number;
          created_at?: string;
        };
        Update: {
          product_id?: string;
          qty_per_unit?: number;
        };
      };

      // Manual deductions and corrections ONLY — stock used or lost outside a
      // sale. Sales and purchases are read from the POS / purchase ledger
      // directly, so nothing is double-counted.
      stock_adjustments: {
        Row: {
          id: string;
          restaurant_id: string;
          product_id: string;
          /** `wastage` is legacy — written before the reason list existed. */
          kind: Database["public"]["Enums"]["stock_reason"];
          qty: number; // signed: + adds stock, − removes it
          notes: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          restaurant_id: string;
          product_id: string;
          kind: Database["public"]["Enums"]["stock_reason"];
          qty: number;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          qty?: number;
          notes?: string | null;
        };
      };

      // A supplier bill. The single source of its stock, its vendor debt and its
      // expense — never copied into any of them.
      purchases: {
        Row: {
          id: string;
          restaurant_id: string;
          seq_no: number;
          purchase_code: string; // generated: PUR-00001
          vendor_id: string;
          payment_method: Database["public"]["Enums"]["payment_method"];
          total_amount: number;
          cash_amount: number;
          online_amount: number;
          /** Still owed to the vendor from this bill. */
          credit_amount: number;
          notes: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          restaurant_id: string;
          seq_no: number;
          vendor_id: string;
          payment_method: Database["public"]["Enums"]["payment_method"];
          total_amount: number;
          cash_amount?: number;
          online_amount?: number;
          credit_amount?: number;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          notes?: string | null;
        };
      };

      // Purchase lines — read directly by `stock_report` as the "Purchased" term.
      purchase_items: {
        Row: {
          id: string;
          purchase_id: string;
          restaurant_id: string;
          product_id: string;
          quantity: number;
          unit_cost: number;
          line_total: number; // generated: quantity × unit_cost
          created_at: string;
        };
        Insert: {
          id?: string;
          purchase_id: string;
          restaurant_id: string;
          product_id: string;
          quantity: number;
          unit_cost: number;
          created_at?: string;
        };
        Update: {
          quantity?: number;
          unit_cost?: number;
        };
      };

      // The ONE number the database cannot derive: the money on hand before the
      // system existed. Seeded once; every later day's opening carries forward.
      finance_openings: {
        Row: {
          restaurant_id: string;
          opening_cash: number;
          opening_online: number;
          /** Movements before this are already baked into the seed. */
          effective_from: string;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          restaurant_id: string;
          opening_cash?: number;
          opening_online?: number;
          effective_from?: string;
          created_by?: string | null;
        };
        Update: {
          opening_cash?: number;
          opening_online?: number;
          effective_from?: string;
        };
      };

      // Money paid TO a vendor against their credit account.
      vendor_payments: {
        Row: {
          id: string;
          vendor_id: string;
          restaurant_id: string;
          amount: number;
          method: Database["public"]["Enums"]["payment_method"];
          notes: string | null;
          paid_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          vendor_id: string;
          restaurant_id: string;
          amount: number;
          method?: Database["public"]["Enums"]["payment_method"];
          notes?: string | null;
          paid_by?: string | null;
          created_at?: string;
        };
        Update: {
          amount?: number;
          method?: Database["public"]["Enums"]["payment_method"];
          notes?: string | null;
        };
      };

      // Repayments collected AFTER the bill closed. The down payment taken at
      // billing is on the `payments` row, not here, so it is never counted twice.
      credit_payments: {
        Row: {
          id: string;
          credit_id: string;
          restaurant_id: string;
          amount: number;
          method: Database["public"]["Enums"]["payment_method"];
          notes: string | null;
          received_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          credit_id: string;
          restaurant_id: string;
          amount: number;
          method?: Database["public"]["Enums"]["payment_method"];
          notes?: string | null;
          received_by?: string | null;
          created_at?: string;
        };
        Update: {
          amount?: number;
          method?: Database["public"]["Enums"]["payment_method"];
          notes?: string | null;
        };
      };

      notifications: {
        Row: {
          id: string;
          restaurant_id: string;
          table_id: string | null;
          room_id: string | null;
          session_id: string | null;
          room_stay_id: string | null;
          type: Database["public"]["Enums"]["notification_type"];
          status: Database["public"]["Enums"]["notification_status"];
          created_at: string;
        };
        Insert: {
          id?: string;
          restaurant_id: string;
          table_id?: string | null;
          room_id?: string | null;
          session_id?: string | null;
          room_stay_id?: string | null;
          type: Database["public"]["Enums"]["notification_type"];
          status?: Database["public"]["Enums"]["notification_status"];
          created_at?: string;
        };
        Update: {
          id?: string;
          restaurant_id?: string;
          table_id?: string | null;
          room_id?: string | null;
          session_id?: string | null;
          room_stay_id?: string | null;
          type?: Database["public"]["Enums"]["notification_type"];
          status?: Database["public"]["Enums"]["notification_status"];
          created_at?: string;
        };
      };
    };

    Views: Record<string, never>;

    Functions: {
      get_restaurant_id: {
        Args: Record<string, never>;
        Returns: string;
      };
      get_user_role: {
        Args: Record<string, never>;
        Returns: string;
      };
      custom_access_token_hook: {
        Args: { event: Json };
        Returns: Json;
      };
      // Money-moving RPCs — one transaction each. Service role only.
      close_bill_with_credit: {
        Args: {
          p_restaurant_id: string;
          p_session_id: string;
          p_total: number;
          p_cash: number;
          p_online: number;
          p_card: number;
          p_customer_name: string;
          p_customer_phone: string | null;
          p_notes: string | null;
          p_created_by: string | null;
        };
        Returns: Database["public"]["Tables"]["credits"]["Row"];
      };
      record_credit_payment: {
        Args: {
          p_restaurant_id: string;
          p_credit_id: string;
          p_amount: number;
          p_method: string;
          p_notes: string | null;
          p_received_by: string | null;
        };
        Returns: Database["public"]["Tables"]["credits"]["Row"];
      };
      create_vendor: {
        Args: {
          p_restaurant_id: string;
          p_name: string;
          p_phone: string | null;
          p_address: string | null;
          p_notes: string | null;
          p_opening_credit: number;
          p_created_by: string | null;
        };
        Returns: Database["public"]["Tables"]["vendors"]["Row"];
      };
      record_vendor_payment: {
        Args: {
          p_restaurant_id: string;
          p_vendor_id: string;
          p_amount: number;
          p_method: string;
          p_notes: string | null;
          p_paid_by: string | null;
        };
        Returns: Database["public"]["Tables"]["vendors"]["Row"];
      };
      create_product: {
        Args: {
          p_restaurant_id: string;
          p_name: string;
          p_unit: string;
          p_opening_stock: number;
          p_low_stock: number;
          p_created_by: string | null;
        };
        Returns: Database["public"]["Tables"]["products"]["Row"];
      };
      // Writes the bill, its lines, the vendor's credit movement and each
      // product's latest cost in ONE transaction.
      record_purchase: {
        Args: {
          p_restaurant_id: string;
          p_vendor_id: string;
          p_method: string;
          p_cash: number;
          p_online: number;
          p_items: { product_id: string; quantity: number; unit_cost: number }[];
          p_notes: string | null;
          p_created_by: string | null;
        };
        Returns: Database["public"]["Tables"]["purchases"]["Row"];
      };
      // Derives the whole Stock screen for a window: opening (= the previous
      // day's closing, so the rollover needs no job), purchases, POS usage,
      // adjustments, and the resulting final stock.
      stock_report: {
        Args: {
          p_restaurant_id: string;
          p_from: string;
          p_to: string;
        };
        Returns: {
          product_id: string;
          opening: number;
          purchased: number;
          /** Sold through the POS, net of same-day reversals. */
          used_pos: number;
          /** Taken out by hand (kitchen usage, waste, damage, staff meals). */
          used_manual: number;
          /** Everything actually consumed = used_pos + manual. */
          used: number;
          /** Same-day reservations released (rejected/cancelled). Already netted
           *  out of `used_pos` — carried separately only so the breakdown can show
           *  the sale and its reversal as two lines. */
          reversed: number;
          /** Put back: manual corrections, plus reservations from an earlier day
           *  released today. Kept apart from `used` so it can't cancel it. */
          added: number;
          /** opening + purchased − used + added */
          closing: number;
        }[];
      };
      // Every movement of one product — opening, purchases, POS sales and manual
      // deductions — with a running balance. Rows come back OLDEST FIRST so the
      // balance accumulates correctly; the screen reverses them.
      product_history: {
        Args: {
          p_restaurant_id: string;
          p_product_id: string;
        };
        Returns: {
          at: string;
          kind: "opening" | "purchase" | "sale" | "manual";
          qty: number; // signed
          /** The reason the admin picked, when kind is `manual`. */
          reason: string | null;
          /** Purchase code, or the menu item that sold it. */
          ref: string | null;
          /** Purchase context — null on every other kind of movement. */
          vendor_name: string | null;
          vendor_code: string | null;
          amount: number | null;
          method: string | null;
          staff_id: string | null;
          balance: number;
        }[];
      };
      // The whole balance sheet for a window, derived from bills, purchases and
      // both credit ledgers. A period's opening IS the previous period's closing.
      finance_report: {
        Args: {
          p_restaurant_id: string;
          p_from: string;
          p_to: string;
        };
        Returns: {
          opening_cash: number;
          opening_online: number;
          sales_cash: number;
          sales_online: number;
          sales_card: number;
          sales_credit: number;
          sales_total: number;
          purchases_cash: number;
          purchases_online: number;
          purchases_credit: number;
          purchases_total: number;
          customer_credit_created: number;
          customer_credit_collected: number;
          vendor_credit_created: number;
          vendor_credit_paid: number;
          customer_credit_outstanding: number;
          vendor_credit_outstanding: number;
          /** How many parties sit behind those outstanding totals. */
          pending_customers: number;
          pending_vendors: number;
          /** Staff salary — money out, on the day it was paid. */
          salary_cash: number;
          salary_online: number;
          salary_advance: number;
          salary_total: number;
          /** Salary accrued but not yet paid, across every month since each hire. */
          salary_outstanding: number;
          closing_cash: number;
          closing_online: number;
          has_opening: boolean;
        }[];
      };
      set_finance_opening: {
        Args: {
          p_restaurant_id: string;
          p_cash: number;
          p_online: number;
          p_effective_from: string;
          p_created_by: string | null;
        };
        Returns: Database["public"]["Tables"]["finance_openings"]["Row"];
      };
      // Every admin-dashboard headline in one round trip. `tracked_revenue` says
      // how much of the day's sales the `cogs` figure actually covers — without
      // it, "estimated profit" would read as pure revenue.
      dashboard_stats: {
        Args: {
          p_restaurant_id: string;
          p_from: string;
          p_to: string;
        };
        Returns: {
          inventory_value: number;
          product_count: number;
          low_count: number;
          out_count: number;
          sales_total: number;
          purchases_total: number;
          cogs: number;
          tracked_revenue: number;
          customer_outstanding: number;
          vendor_outstanding: number;
        }[];
      };
    };

    Enums: {
      restaurant_type:     "restaurant" | "cafe" | "lodge" | "guesthouse" | "hotel" | "resort";
      subscription_tier:   "free" | "basic" | "pro";
      user_role:           "restaurant_admin" | "restaurant_employee";
      room_status:         "available" | "occupied" | "cleaning" | "maintenance";
      room_stay_status:    "active" | "checked_out";
      room_charge_type:    "room_rate" | "laundry" | "mini_bar" | "extra_bed" | "other";
      session_type:        "table" | "walk_in" | "credit" | "room_service";
      session_status:      "active" | "closed" | "pending_activation";
      order_status:        "pending" | "accepted" | "preparing" | "ready" | "served" | "cancelled";
      item_status:         "pending" | "ready" | "served";
      payment_method:      "cash" | "card" | "upi" | "other" | "online" | "mixed" | "credit";
      credit_status:       "pending" | "partially_paid" | "fully_paid";
      // Not a DB enum — a CHECK constraint on stock_adjustments.kind.
      stock_reason:        "kitchen_usage" | "waste" | "damage" | "staff_consumption" | "adjustment" | "other" | "wastage";
      notification_type:   "call_waiter" | "request_bill" | "call_reception" | "call_housekeeping" | "call_restaurant" | "request_maintenance" | "new_order" | "order_ready" | "table_activation_request";
      notification_status: "pending" | "resolved";
    };
  };
};
