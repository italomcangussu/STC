import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://smztsayzldjmkzmufqcz.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtenRzYXl6bGRqbWt6bXVmcWN6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgxNTEzMzksImV4cCI6MjA3MzcyNzMzOX0.mI_nVpDhFhEcERqbB0sucqJAcNkNJxldRg8JmKics9g';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
