(function () {
    if (window.__supabaseClient) return;

    var SUPABASE_URL = window.__SUPABASE_URL;
    var SUPABASE_ANON_KEY = window.__SUPABASE_ANON_KEY;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        console.warn('Supabase credentials not configured');
        return;
    }

    var supabase = supabaseClient.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    window.__supabase = supabase;

    window.__supabaseSocialLogin = function (provider) {
        supabase.auth.signInWithOAuth({
            provider: provider,
            options: {
                redirectTo: window.location.origin + '/auth/callback'
            }
        });
    };
})();
