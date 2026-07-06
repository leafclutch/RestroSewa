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
          payment_method?: Database["public"]["Enums"]["payment_method"];
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
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
    };

    Enums: {
      restaurant_type:     "restaurant" | "cafe" | "lodge" | "guesthouse" | "hotel" | "resort";
      subscription_tier:   "free" | "basic" | "pro";
      user_role:           "restaurant_admin" | "restaurant_employee";
      room_status:         "available" | "occupied" | "cleaning" | "maintenance";
      room_stay_status:    "active" | "checked_out";
      room_charge_type:    "room_rate" | "laundry" | "mini_bar" | "extra_bed" | "other";
      session_type:        "table" | "walk_in" | "credit" | "room_service";
      session_status:      "active" | "closed";
      order_status:        "pending" | "accepted" | "preparing" | "ready" | "served" | "cancelled";
      item_status:         "pending" | "ready" | "served";
      payment_method:      "cash" | "card" | "upi" | "other";
      notification_type:   "call_waiter" | "request_bill" | "call_reception" | "call_housekeeping" | "call_restaurant" | "request_maintenance";
      notification_status: "pending" | "resolved";
    };
  };
};
