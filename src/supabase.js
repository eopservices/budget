import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://wikwisponkftlelrmwfb.supabase.co'
const supabaseAnonKey = 'sb_publishable_cTDMHfmJ6huyO-H_nNdaGA_OpOIHa-y'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
